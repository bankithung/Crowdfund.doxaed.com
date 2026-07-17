"""Public (unauthenticated) endpoints: campaign page data, donor wall,
payment claims, donor status check, and the SPA shell for /c/<slug> with
per-campaign OpenGraph tags injected so WhatsApp/social links unfurl."""

import logging
import re

from django.conf import settings
from django.db.models import F, Q
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.html import escape

from core.api import (as_bool, err, methods, ok, paginate, rate_limit)

from .emails import notify_owner_new_claim
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
    notify_owner_new_claim(donation)   # organizer verifies faster when pinged
    return ok({"donation": {
        "public_id": donation.public_id,
        "status": donation.status,
        "donor_name": donation.donor_name,
        "amount": float(donation.amount),
    }}, status=201)


def _status_dict(donation):
    return {
        "public_id": donation.public_id,
        "status": donation.status,
        "donor_name": donation.donor_name,
        "amount": float(donation.amount),
        "review_note": donation.review_note,
        "created_at": donation.created_at.isoformat(),
        "reviewed_at": donation.reviewed_at.isoformat() if donation.reviewed_at else None,
        "campaign_title": donation.campaign.title,
        "campaign_slug": donation.campaign.slug,
    }


@methods("GET")
def public_donation_status_view(request, public_id):
    if rate_limit(request, "status_check", 30, 600):
        return err("Too many checks — please wait a few minutes.", 429, "throttled")
    donation = get_object_or_404(Donation.objects.select_related("campaign"),
                                 public_id=public_id.strip().upper())
    return ok({"donation": _status_dict(donation)})


@methods("GET")
def public_donation_lookup_view(request):
    """Find claims by whatever the supporter still has: the reference code,
    the UPI transaction ID, or the UPI ID / phone number they paid from."""
    if rate_limit(request, "status_check", 30, 600):
        return err("Too many checks — please wait a few minutes.", 429, "throttled")
    q = str(request.GET.get("q") or "").strip()
    if len(q) < 4:
        return err("Enter at least 4 characters to search.", 400, "validation")
    matches = (Donation.objects.select_related("campaign")
               .filter(Q(public_id__iexact=q) |
                       Q(transaction_ref__iexact=q) |
                       Q(payer_id__iexact=q))
               .order_by("-created_at")[:5])
    return ok({"donations": [_status_dict(d) for d in matches]})


RECEIPT_PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Receipt {public_id} — CrowdFund</title>
<style>
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{ font-family: -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;
         background: #eef0f6; color: #171a26; padding: 28px 14px; }}
  .sheet {{ max-width: 560px; margin: 0 auto; background: #fff;
           border: 1px solid #dfe3ee; border-radius: 8px; overflow: hidden; }}
  .head {{ display: flex; justify-content: space-between; align-items: center;
          padding: 18px 24px; border-bottom: 3px solid #12b76a; }}
  .brand {{ font-size: 17px; font-weight: 800; }}
  .brand span {{ color: #0e9f5d; }}
  .tag {{ font-size: 11px; font-weight: 700; letter-spacing: 0.08em;
         color: #667085; text-transform: uppercase; }}
  .body {{ padding: 24px; }}
  .amount {{ font-size: 34px; font-weight: 800; color: #0e9f5d; }}
  .from {{ margin-top: 4px; color: #475467; font-size: 14px; }}
  .from strong {{ color: #171a26; }}
  table {{ width: 100%; margin-top: 18px; border-collapse: collapse; font-size: 13.5px; }}
  td {{ padding: 9px 0; border-top: 1px solid #eef0f6; vertical-align: top; }}
  td:first-child {{ color: #667085; width: 42%; }}
  td:last-child {{ font-weight: 600; text-align: right; overflow-wrap: anywhere; }}
  .ok {{ display: inline-block; margin-top: 14px; padding: 4px 12px; border-radius: 999px;
        background: #e7f8f0; color: #0e9f5d; font-size: 12.5px; font-weight: 700; }}
  .note {{ margin-top: 18px; padding: 12px 14px; background: #f7f8fc; border-radius: 6px;
          color: #667085; font-size: 12px; line-height: 1.6; }}
  .actions {{ text-align: center; margin: 18px auto 4px; }}
  .btn {{ display: inline-block; padding: 10px 22px; border: none; border-radius: 6px;
         background: #5548e8; color: #fff; font-size: 14px; font-weight: 700; cursor: pointer; }}
  @media print {{ body {{ background: #fff; padding: 0; }}
                 .sheet {{ border: none; }} .actions {{ display: none; }} }}
</style></head><body>
<div class="sheet">
  <div class="head">
    <span class="brand">Crowd<span>Fund</span></span>
    <span class="tag">Contribution receipt</span>
  </div>
  <div class="body">
    <div class="amount">{amount}</div>
    <p class="from">received from <strong>{donor_name}</strong></p>
    <span class="ok">✓ Verified by the organizer</span>
    <table>
      <tr><td>Receipt / reference no.</td><td>{public_id}</td></tr>
      <tr><td>Fundraiser</td><td>{campaign_title}</td></tr>
      <tr><td>Organizer</td><td>{organizer}</td></tr>{txn_row}
      <tr><td>Submitted on</td><td>{created}</td></tr>
      <tr><td>Verified on</td><td>{reviewed}</td></tr>
    </table>
    <p class="note">This receipt acknowledges a voluntary contribution paid through UPI
    directly to the organizer's account. CrowdFund (crowdfund.doxaed.com) facilitates
    verification only and does not collect or hold funds. Verify this reference any time
    at {status_url}</p>
  </div>
</div>
<div class="actions"><button class="btn" onclick="window.print()">Download / Print receipt</button></div>
</body></html>"""


@methods("GET")
def donation_receipt_view(request, public_id):
    """Printable receipt — donors reach it from the status check, organizers
    from the dashboard. Only confirmed contributions have receipts; the
    unguessable reference code is the access key."""
    donation = get_object_or_404(
        Donation.objects.select_related("campaign", "campaign__owner"),
        public_id=public_id.strip().upper(), status="confirmed")
    campaign = donation.campaign
    tz = timezone.get_current_timezone()
    fmt = lambda dt: dt.astimezone(tz).strftime("%d %b %Y, %I:%M %p") if dt else "—"  # noqa: E731
    txn_row = (f"\n      <tr><td>UPI transaction ID</td><td>{escape(donation.transaction_ref)}</td></tr>"
               if donation.transaction_ref else "")
    html = RECEIPT_PAGE.format(
        public_id=escape(donation.public_id),
        amount=f"₹{donation.amount:,.2f}".rstrip("0").rstrip("."),
        donor_name=escape(donation.donor_name),
        campaign_title=escape(campaign.title),
        organizer=escape(campaign.owner.name),
        txn_row=txn_row,
        created=fmt(donation.created_at),
        reviewed=fmt(donation.reviewed_at),
        status_url=escape(f"{settings.PUBLIC_BASE_URL}/c/{campaign.slug}?ref={donation.public_id}"),
    )
    response = HttpResponse(html, content_type="text/html; charset=utf-8")
    response["Cache-Control"] = "private, max-age=300"
    return response


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
