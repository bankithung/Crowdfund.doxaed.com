"""Public (unauthenticated) endpoints: campaign page data, donor wall,
payment claims, donor status check, and the SPA shell for /c/<slug> with
per-campaign OpenGraph tags injected so WhatsApp/social links unfurl."""

import logging
import re

from django.conf import settings
from django.db.models import F
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.html import escape

from core.api import (as_bool, err, methods, ok, paginate, rate_limit)

from .images import ImageError, process_image
from .models import Campaign, Donation
from .serializers import campaign_dict, donor_public_dict, share_url
from .validators import clean_donation_fields

log = logging.getLogger("crowdfund.public")

_TITLE_RE = re.compile(r"<title>.*?</title>", re.DOTALL)
_shell_cache = {"mtime": None, "html": None}


def _campaign_is_open(campaign):
    if campaign.status != "active":
        return False
    if campaign.end_date and campaign.end_date < timezone.localdate():
        return False
    return True


@methods("GET")
def public_campaigns_index(request):
    """Active fundraisers + platform-wide stats for the homepage marquee."""
    if rate_limit(request, "pub_index", 60, 60):
        return err("Too many requests.", 429, "throttled")
    from django.db.models import Count, DecimalField, Q, Sum, Value
    from django.db.models.functions import Coalesce

    money = DecimalField(max_digits=14, decimal_places=2)
    campaigns = (Campaign.objects.filter(status="active")
                 .select_related("owner")
                 .annotate(
                     raised=Coalesce(Sum("donations__amount",
                                         filter=Q(donations__status="confirmed")),
                                     Value(0), output_field=money),
                     confirmed_count=Count("donations",
                                           filter=Q(donations__status="confirmed")),
                     pending_count=Count("donations",
                                         filter=Q(donations__status="pending")),
                 )
                 .order_by("-created_at")[:20])

    totals = Donation.objects.filter(status="confirmed").aggregate(
        raised=Coalesce(Sum("amount"), Value(0), output_field=money),
        donors=Count("id"),
    )
    return ok({
        "campaigns": [{
            "title": c.title,
            "slug": c.slug,
            "category_label": c.get_category_display(),
            "organizer": c.owner.name,
            "raised": float(c.raised),
            "goal": float(c.goal_amount),
            "progress": min(round(float(c.raised) / float(c.goal_amount) * 100, 1)
                            if c.goal_amount else 0.0, 999.0),
            "cover_url": c.cover_image.url if c.cover_image else None,
        } for c in campaigns],
        "stats": {
            "raised": float(totals["raised"]),
            "contributions": totals["donors"],
            "active_campaigns": Campaign.objects.filter(status="active").count(),
        },
    })


@methods("GET")
def public_campaign_view(request, slug):
    campaign = get_object_or_404(Campaign.objects.select_related("owner"), slug=slug)
    Campaign.objects.filter(pk=campaign.pk).update(views=F("views") + 1)
    data = campaign_dict(campaign)
    data["is_open"] = _campaign_is_open(campaign)
    return ok({"campaign": data})


@methods("GET")
def public_donors_view(request, slug):
    campaign = get_object_or_404(Campaign, slug=slug)
    qs = campaign.donations.filter(status="confirmed")
    sort = request.GET.get("sort", "recent")
    if sort == "top" and campaign.show_amounts:
        qs = qs.order_by("-amount", "-created_at")
    else:
        qs = qs.order_by("-created_at")
    items, meta = paginate(qs, request, default_size=20, max_size=50)
    return ok({
        "donors": [donor_public_dict(d, campaign.show_amounts) for d in items],
        "meta": meta,
    })


@methods("POST")
def public_donate_view(request, slug):
    campaign = get_object_or_404(Campaign, slug=slug)
    if not _campaign_is_open(campaign):
        return err("This campaign is not accepting contributions right now.",
                   400, "campaign_closed")

    # Honeypot: hidden field real users never fill. Pretend success for bots.
    if str(request.POST.get("website") or "").strip():
        log.warning("honeypot tripped slug=%s", slug)
        return ok({"donation": {"public_id": Donation.generate_public_id(),
                                "status": "pending"}}, status=201)

    if rate_limit(request, "donate_min", 4, 60):
        return err("Too many submissions — please wait a minute and try again.",
                   429, "throttled")
    if rate_limit(request, "donate_hour", 20, 3600):
        return err("Too many submissions from your network — try again later.",
                   429, "throttled")

    cleaned, errors = clean_donation_fields(request.POST)

    screenshot_file = request.FILES.get("screenshot")
    screenshot_content = None
    if screenshot_file:
        try:
            screenshot_content, _ = process_image(screenshot_file, max_dim=2000,
                                                  force="auto")
        except ImageError as exc:
            errors["screenshot"] = str(exc)

    if not errors.get("transaction_ref") and not cleaned.get("transaction_ref") \
            and not screenshot_content:
        errors["transaction_ref"] = ("Add the UPI transaction ID or attach a "
                                     "payment screenshot so the organizer can verify.")

    if errors:
        return err("Please fix the highlighted fields.", 400, "validation", fields=errors)

    donation = Donation(
        campaign=campaign,
        public_id=Donation.generate_public_id(),
        donor_name=cleaned["donor_name"],
        donor_email=cleaned["donor_email"],
        amount=cleaned["amount"],
        message=cleaned["message"],
        is_anonymous=as_bool(request.POST.get("is_anonymous", "")),
        transaction_ref=cleaned["transaction_ref"],
        payer_id=cleaned["payer_id"],
        submitted_ip=request.META.get("HTTP_X_FORWARDED_FOR", "").split(",")[0].strip()
                     or request.META.get("REMOTE_ADDR"),
    )
    if screenshot_content:
        donation.screenshot.save(screenshot_content.name, screenshot_content, save=False)
    donation.save()
    log.info("donation submitted id=%s campaign=%s amount=%s", donation.pk,
             campaign.pk, donation.amount)
    return ok({"donation": {
        "public_id": donation.public_id,
        "status": donation.status,
        "donor_name": donation.donor_name,
        "amount": float(donation.amount),
    }}, status=201)


@methods("GET")
def public_donation_status_view(request, public_id):
    if rate_limit(request, "status_check", 30, 600):
        return err("Too many checks — please wait a few minutes.", 429, "throttled")
    donation = get_object_or_404(Donation.objects.select_related("campaign"),
                                 public_id=public_id.strip().upper())
    return ok({"donation": {
        "public_id": donation.public_id,
        "status": donation.status,
        "donor_name": donation.donor_name,
        "amount": float(donation.amount),
        "review_note": donation.review_note,
        "created_at": donation.created_at.isoformat(),
        "reviewed_at": donation.reviewed_at.isoformat() if donation.reviewed_at else None,
        "campaign_title": donation.campaign.title,
        "campaign_slug": donation.campaign.slug,
    }})


@methods("POST")
def parse_screenshot_view(request):
    """OCR an uploaded payment screenshot and return best-effort details
    (transaction ID, amount, payer VPA/phone) for prefilling the claim form.
    Extraction only — nothing is stored here."""
    if rate_limit(request, "ocr_min", 4, 60):
        return err("Too many attempts — please wait a minute.", 429, "throttled")
    if rate_limit(request, "ocr_hour", 15, 3600):
        return err("Too many attempts — try again later.", 429, "throttled")

    upload = request.FILES.get("screenshot")
    if not upload:
        return err("Attach a screenshot image.", 400, "validation")
    try:
        content, _ = process_image(upload, max_dim=2200, force="auto")
    except ImageError as exc:
        return err(str(exc), 400, "validation")

    exclude = []
    slug = str(request.POST.get("slug") or "").strip()
    if slug:
        campaign = Campaign.objects.filter(slug=slug).first()
        if campaign:
            exclude.append(campaign.upi_id)
            match = re.search(r"[?&]pa=([^&]+)", campaign.qr_payload or "", re.I)
            if match:
                exclude.append(match.group(1))

    from io import BytesIO

    from .ocr import parse_payment_screenshot
    detected = parse_payment_screenshot(BytesIO(content.file.getvalue()), exclude)
    log.info("ocr parse slug=%s found=%s", slug,
             {k: bool(v) for k, v in detected.items()})
    return ok({"detected": detected})


# ------------------------------------------------------------ share shell

def _load_shell():
    path = settings.FRONTEND_DIST / "index.html"
    try:
        mtime = path.stat().st_mtime
    except OSError:
        return None
    if _shell_cache["mtime"] != mtime:
        _shell_cache["html"] = path.read_text(encoding="utf-8")
        _shell_cache["mtime"] = mtime
    return _shell_cache["html"]


def campaign_share_page(request, slug):
    """Serve the SPA shell with campaign-specific OG/Twitter meta so shared
    links unfurl with the campaign's own title, blurb and image."""
    shell = _load_shell()
    if shell is None:
        return HttpResponse("Frontend build not found.", status=503,
                            content_type="text/plain")

    campaign = Campaign.objects.filter(slug=slug).select_related("owner").first()
    if campaign is not None:
        title = escape(f"{campaign.title} — support this fundraiser")
        desc_source = campaign.tagline or campaign.description[:180]
        desc = escape(" ".join(desc_source.split()))
        url = escape(share_url(campaign))
        first_extra = campaign.images.first()
        if campaign.cover_image:
            image = escape(settings.PUBLIC_BASE_URL + campaign.cover_image.url)
        elif first_extra:
            image = escape(settings.PUBLIC_BASE_URL + first_extra.image.url)
        else:
            image = escape(settings.PUBLIC_BASE_URL + "/share-default.png")
        og = (
            f'<meta property="og:type" content="website">'
            f'<meta property="og:site_name" content="CrowdFund">'
            f'<meta property="og:title" content="{title}">'
            f'<meta property="og:description" content="{desc}">'
            f'<meta property="og:url" content="{url}">'
            f'<meta property="og:image" content="{image}">'
            f'<meta name="twitter:card" content="summary_large_image">'
            f'<meta name="twitter:title" content="{title}">'
            f'<meta name="twitter:description" content="{desc}">'
            f'<meta name="twitter:image" content="{image}">'
            f'<meta name="description" content="{desc}">'
        )
        shell = _TITLE_RE.sub(f"<title>{title}</title>", shell, count=1)
        shell = shell.replace("<!--OG-->", og)

    response = HttpResponse(shell, content_type="text/html; charset=utf-8")
    response["Cache-Control"] = "public, max-age=120"
    return response
