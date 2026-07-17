"""Owner-facing API: dashboard, campaign CRUD, donation review, analytics,
CSV export, and owner-only proof images. Every object access is scoped to
request.user — there is no way to reach another organizer's data."""

import csv
import datetime
import logging
import mimetypes

from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db.models import Count, DecimalField, Q, Sum, Value
from django.db.models.functions import Coalesce, TruncDate
from django.conf import settings
from django.http import FileResponse, Http404, HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone

from core.api import (BodyError, as_bool, err, methods, ok, paginate,
                      parse_body, require_login, throttle)

from .images import (ImageError, decode_qr_payload, delete_file_quiet,
                     process_image)
from .models import Campaign, CampaignImage, Donation
from .serializers import (analytics_dict, campaign_dict, donation_admin_dict,
                          share_url)
from .validators import (DONATION_MAX, DONATION_MIN, PHONE_RE, TXN_REF_RE,
                         UPI_RE, clean_campaign_fields, clean_donation_fields,
                         parse_amount)

log = logging.getLogger("crowdfund.campaigns")

MONEY_FIELD = DecimalField(max_digits=14, decimal_places=2)


def owned_campaigns(user):
    return user.campaigns.prefetch_related("images").annotate(
        raised=Coalesce(Sum("donations__amount", filter=Q(donations__status="confirmed")),
                        Value(0), output_field=MONEY_FIELD),
        confirmed_count=Count("donations", filter=Q(donations__status="confirmed")),
        pending_count=Count("donations", filter=Q(donations__status="pending")),
    )


def get_owned_campaign(request, pk):
    return get_object_or_404(Campaign, pk=pk, owner=request.user)


# --------------------------------------------------------------- dashboard

@methods("GET")
@require_login
def dashboard_view(request):
    campaigns = list(owned_campaigns(request.user).order_by("-created_at"))
    totals = Donation.objects.filter(campaign__owner=request.user).aggregate(
        raised=Coalesce(Sum("amount", filter=Q(status="confirmed")),
                        Value(0), output_field=MONEY_FIELD),
        donors=Count("id", filter=Q(status="confirmed")),
        pending=Count("id", filter=Q(status="pending")),
    )
    recent = (Donation.objects.filter(campaign__owner=request.user)
              .select_related("campaign")[:10])
    return ok({
        "totals": {
            "raised": float(totals["raised"]),
            "donors": totals["donors"],
            "pending": totals["pending"],
            "campaigns": len(campaigns),
            "active_campaigns": sum(1 for c in campaigns if c.status == "active"),
        },
        "campaigns": [campaign_dict(c, private=True) for c in campaigns],
        "recent": [
            {**donation_admin_dict(d),
             "campaign_title": d.campaign.title,
             "campaign_slug": d.campaign.slug}
            for d in recent
        ],
    })


# --------------------------------------------------------------- campaigns

@methods("GET", "POST")
@require_login
def campaigns_view(request):
    if request.method == "GET":
        campaigns = owned_campaigns(request.user).order_by("-created_at")
        return ok({"campaigns": [campaign_dict(c, private=True) for c in campaigns]})
    return _create_campaign(request)


@throttle("campaign_create", limit=20, window_seconds=86400, per="user")
def _create_campaign(request):
    data = request.POST
    cleaned, errors = clean_campaign_fields(data, partial=False)

    qr_file = request.FILES.get("qr_code")
    if not qr_file:
        errors["qr_code"] = "Upload the payment QR code image donors will scan."

    cover_file = request.FILES.get("cover_image")
    qr_content = cover_content = None
    try:
        if qr_file:
            qr_content, _ = process_image(qr_file, max_dim=1600, force="png")
    except ImageError as exc:
        errors["qr_code"] = str(exc)
    try:
        if cover_file:
            cover_content, _ = process_image(cover_file, max_dim=2000, force="jpeg")
    except ImageError as exc:
        errors["cover_image"] = str(exc)

    if errors:
        return err("Please fix the highlighted fields.", 400, "validation", fields=errors)

    campaign = Campaign(
        owner=request.user,
        title=cleaned["title"],
        slug=Campaign.generate_slug(cleaned["title"]),
        tagline=cleaned.get("tagline", ""),
        description=cleaned["description"],
        category=cleaned.get("category", "other"),
        goal_amount=cleaned["goal_amount"],
        upi_id=cleaned.get("upi_id", ""),
        payee_name=cleaned.get("payee_name", ""),
        end_date=cleaned.get("end_date"),
        show_amounts=as_bool(data.get("show_amounts", "true")),
    )
    campaign.qr_payload = decode_qr_payload(qr_content)
    campaign.qr_code.save(qr_content.name, qr_content, save=False)
    if cover_content:
        campaign.cover_image.save(cover_content.name, cover_content, save=False)
    campaign.save()
    log.info("campaign created id=%s owner=%s slug=%s qr_decoded=%s", campaign.pk,
             request.user.pk, campaign.slug, bool(campaign.qr_payload))
    return ok({"campaign": campaign_dict(campaign, private=True)}, status=201)


@methods("GET", "POST", "DELETE")
@require_login
def campaign_detail_view(request, pk):
    campaign = get_owned_campaign(request, pk)

    if request.method == "GET":
        return ok({"campaign": campaign_dict(campaign, private=True)})

    if request.method == "DELETE":
        for donation in campaign.donations.all():
            delete_file_quiet(donation.screenshot)
        for extra in campaign.images.all():
            delete_file_quiet(extra.image)
        delete_file_quiet(campaign.qr_code)
        delete_file_quiet(campaign.cover_image)
        log.info("campaign deleted id=%s owner=%s", campaign.pk, request.user.pk)
        campaign.delete()
        return ok({"deleted": True})

    # POST = partial update (multipart-friendly)
    data = request.POST
    cleaned, errors = clean_campaign_fields(data, partial=True)

    if "status" in data:
        status = str(data.get("status")).strip().lower()
        if status not in {"active", "paused", "ended"}:
            errors["status"] = "Invalid status."
        else:
            cleaned["status"] = status

    qr_content = cover_content = None
    try:
        if request.FILES.get("qr_code"):
            qr_content, _ = process_image(request.FILES["qr_code"], max_dim=1600, force="png")
    except ImageError as exc:
        errors["qr_code"] = str(exc)
    try:
        if request.FILES.get("cover_image"):
            cover_content, _ = process_image(request.FILES["cover_image"],
                                             max_dim=2000, force="jpeg")
    except ImageError as exc:
        errors["cover_image"] = str(exc)

    if errors:
        return err("Please fix the highlighted fields.", 400, "validation", fields=errors)

    for field in ("title", "tagline", "description", "category", "goal_amount",
                  "upi_id", "payee_name", "end_date", "status"):
        if field in cleaned:
            setattr(campaign, field, cleaned[field])
    if "show_amounts" in data:
        campaign.show_amounts = as_bool(data.get("show_amounts"))

    if qr_content:
        delete_file_quiet(campaign.qr_code)
        campaign.qr_payload = decode_qr_payload(qr_content)
        campaign.qr_code.save(qr_content.name, qr_content, save=False)
    if cover_content:
        delete_file_quiet(campaign.cover_image)
        campaign.cover_image.save(cover_content.name, cover_content, save=False)
    elif as_bool(data.get("remove_cover", "")) and campaign.cover_image:
        delete_file_quiet(campaign.cover_image)
        campaign.cover_image = None

    campaign.save()
    return ok({"campaign": campaign_dict(campaign, private=True)})


# ----------------------------------------------------------------- gallery

MAX_GALLERY_IMAGES = 6


@methods("POST")
@require_login
def campaign_images_view(request, pk):
    campaign = get_owned_campaign(request, pk)
    if campaign.images.count() >= MAX_GALLERY_IMAGES:
        return err(f"You can add up to {MAX_GALLERY_IMAGES} gallery photos "
                   "(plus the cover).", 400, "validation",
                   fields={"image": "Gallery is full — remove a photo first."})
    upload = request.FILES.get("image")
    if not upload:
        return err("Attach an image.", 400, "validation",
                   fields={"image": "Choose a photo to add."})
    try:
        content, _ = process_image(upload, max_dim=2000, force="jpeg")
    except ImageError as exc:
        return err("Please fix the highlighted fields.", 400, "validation",
                   fields={"image": str(exc)})

    last = campaign.images.order_by("-position").first()
    item = CampaignImage(campaign=campaign,
                         position=(last.position + 1) if last else 1)
    item.image.save(content.name, content, save=False)
    item.save()
    return ok({"campaign": campaign_dict(campaign, private=True)}, status=201)


@methods("DELETE")
@require_login
def campaign_image_delete_view(request, pk, image_id):
    campaign = get_owned_campaign(request, pk)
    item = get_object_or_404(CampaignImage, pk=image_id, campaign=campaign)
    delete_file_quiet(item.image)
    item.delete()
    return ok({"campaign": campaign_dict(campaign, private=True)})


# --------------------------------------------------------------- donations

@methods("GET", "POST")
@require_login
def campaign_donations_view(request, pk):
    campaign = get_owned_campaign(request, pk)
    if request.method == "POST":
        return _add_manual_donation(request, campaign)
    qs = campaign.donations.all()

    status = request.GET.get("status", "all")
    if status in {"pending", "confirmed", "rejected"}:
        qs = qs.filter(status=status)

    query = (request.GET.get("q") or "").strip()
    if query:
        qs = qs.filter(Q(donor_name__icontains=query) |
                       Q(transaction_ref__icontains=query) |
                       Q(public_id__iexact=query) |
                       Q(donor_email__icontains=query))

    items, meta = paginate(qs, request, default_size=20)
    return ok({"donations": [donation_admin_dict(d) for d in items], "meta": meta})


def _add_manual_donation(request, campaign):
    """Organizer records a payment that arrived without a claim — cash, a
    direct transfer, a supporter who never submitted proof. Created already
    confirmed: the organizer has seen the money."""
    try:
        data = parse_body(request)
    except BodyError as exc:
        return err(str(exc), 400, "bad_body")

    cleaned, errors = clean_donation_fields(data)
    if errors:
        return err("Please fix the highlighted fields.", 400, "validation",
                   fields=errors)

    donation = Donation(
        campaign=campaign,
        public_id=Donation.generate_public_id(),
        donor_name=cleaned["donor_name"],
        donor_email=cleaned["donor_email"],
        amount=cleaned["amount"],
        message=cleaned["message"],
        is_anonymous=as_bool(data.get("is_anonymous", "")),
        transaction_ref=cleaned["transaction_ref"],
        payer_id=cleaned["payer_id"],
        status="confirmed",
        reviewed_at=timezone.now(),
    )
    donation.save()
    log.info("manual donation added id=%s campaign=%s amount=%s owner=%s",
             donation.pk, campaign.pk, donation.amount, request.user.pk)
    return ok({
        "donation": donation_admin_dict(donation),
        "campaign_stats": campaign_dict(campaign, private=True)["stats"],
    }, status=201)


@methods("POST")
@require_login
def donation_review_view(request, pk):
    donation = get_object_or_404(Donation.objects.select_related("campaign"),
                                 pk=pk, campaign__owner=request.user)
    try:
        data = parse_body(request)
    except BodyError as exc:
        return err(str(exc), 400, "bad_body")

    action = str(data.get("action") or "").strip().lower()
    if action not in {"confirm", "reject", "pending"}:
        return err("Action must be confirm, reject or pending.", 400, "validation")

    note = str(data.get("note") or "").strip()[:200]
    donation.status = {"confirm": "confirmed", "reject": "rejected",
                       "pending": "pending"}[action]
    donation.review_note = note if action == "reject" else ""
    donation.reviewed_at = None if action == "pending" else timezone.now()
    donation.save(update_fields=["status", "review_note", "reviewed_at"])

    campaign = donation.campaign
    log.info("donation %s -> %s (campaign=%s owner=%s)", donation.pk,
             donation.status, campaign.pk, request.user.pk)
    return ok({
        "donation": donation_admin_dict(donation),
        "campaign_stats": campaign_dict(campaign, private=True)["stats"],
    })


@methods("POST")
@require_login
def donation_edit_view(request, pk):
    """Fix a claim after submission — a mistaken anonymous tick, a name typo,
    a wrong amount. Owner-scoped; only the fields sent are touched, and the
    audit trail (proof, ref, timestamps, status) stays intact."""
    donation = get_object_or_404(Donation.objects.select_related("campaign"),
                                 pk=pk, campaign__owner=request.user)
    try:
        data = parse_body(request)
    except BodyError as exc:
        return err(str(exc), 400, "bad_body")

    errors, fields = {}, []

    if "donor_name" in data:
        name = str(data.get("donor_name") or "").strip()
        if not 2 <= len(name) <= 60:
            errors["donor_name"] = "Name should be 2–60 characters."
        else:
            donation.donor_name = name
            fields.append("donor_name")

    if "amount" in data:
        try:
            donation.amount = parse_amount(data.get("amount"),
                                           DONATION_MIN, DONATION_MAX, "amount")
            fields.append("amount")
        except ValidationError as exc:
            errors["amount"] = exc.messages[0]

    if "message" in data:
        message = str(data.get("message") or "").strip()
        if len(message) > 280:
            errors["message"] = "Message must be at most 280 characters."
        else:
            donation.message = message
            fields.append("message")

    if "is_anonymous" in data:
        donation.is_anonymous = as_bool(data.get("is_anonymous"))
        fields.append("is_anonymous")

    if "transaction_ref" in data:
        ref = str(data.get("transaction_ref") or "").strip()
        if ref and not TXN_REF_RE.match(ref):
            errors["transaction_ref"] = "Transaction ID should be 4–64 letters, digits or dashes."
        else:
            donation.transaction_ref = ref
            fields.append("transaction_ref")

    if "payer_id" in data:
        payer = str(data.get("payer_id") or "").strip()
        if payer and not (UPI_RE.match(payer) or PHONE_RE.match(payer)):
            errors["payer_id"] = "Enter a valid UPI ID (name@bank) or 10-digit mobile number."
        else:
            donation.payer_id = payer
            fields.append("payer_id")

    if "donor_email" in data:
        email = str(data.get("donor_email") or "").strip().lower()
        if email:
            try:
                validate_email(email)
                donation.donor_email = email[:254]
                fields.append("donor_email")
            except ValidationError:
                errors["donor_email"] = "Enter a valid email (or leave it empty)."
        else:
            donation.donor_email = ""
            fields.append("donor_email")

    if errors:
        return err("Please fix the highlighted fields.", 400, "validation",
                   fields=errors)
    if not fields:
        return err("Nothing to update.", 400, "validation")

    donation.save(update_fields=fields)
    log.info("donation %s edited (%s) by owner=%s", donation.pk,
             ",".join(fields), request.user.pk)
    return ok({
        "donation": donation_admin_dict(donation),
        "campaign_stats": campaign_dict(donation.campaign, private=True)["stats"],
    })


@methods("GET")
@require_login
def donation_proof_view(request, pk):
    donation = get_object_or_404(Donation.objects.select_related("campaign"),
                                 pk=pk, campaign__owner=request.user)
    if not donation.screenshot:
        raise Http404
    name = donation.screenshot.name                      # e.g. proofs/<hex>.jpg
    ctype = mimetypes.guess_type(name)[0] or "application/octet-stream"

    if settings.PROTECTED_PROOFS_VIA_NGINX:
        response = HttpResponse(content_type=ctype)
        response["X-Accel-Redirect"] = f"/_protected_media/{name}"
    else:
        response = FileResponse(donation.screenshot.open("rb"), content_type=ctype)
    response["Content-Disposition"] = f'inline; filename="proof-{donation.public_id}.{name.rsplit(".", 1)[-1]}"'
    response["Cache-Control"] = "private, max-age=300"
    return response


# --------------------------------------------------------------- analytics

@methods("GET")
@require_login
def campaign_analytics_view(request, pk):
    campaign = get_owned_campaign(request, pk)
    today = timezone.localdate()
    start = today - datetime.timedelta(days=29)

    rows = (campaign.donations
            .filter(status="confirmed", created_at__date__gte=start)
            .annotate(day=TruncDate("created_at"))
            .values("day")
            .annotate(total=Sum("amount"), n=Count("id"))
            .order_by("day"))
    by_day = {row["day"]: row for row in rows}
    series = []
    for offset in range(30):
        day = start + datetime.timedelta(days=offset)
        row = by_day.get(day)
        series.append({
            "date": day.isoformat(),
            "amount": float(row["total"]) if row else 0.0,
            "count": row["n"] if row else 0,
        })

    recent = [donation_admin_dict(d) for d in campaign.donations.all()[:8]]
    return ok({"analytics": analytics_dict(campaign, series, recent),
               "campaign": campaign_dict(campaign, private=True)})


@methods("GET")
@require_login
def campaign_export_view(request, pk):
    campaign = get_owned_campaign(request, pk)
    response = HttpResponse(content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = f'attachment; filename="{campaign.slug}-donations.csv"'
    response.write("﻿")  # BOM so Excel opens UTF-8 correctly
    writer = csv.writer(response)
    writer.writerow(["Reference", "Date", "Name", "Email", "Amount (INR)", "Status",
                     "Transaction ID", "Payer UPI/Phone", "Anonymous", "Message",
                     "Reviewed at", "Note"])
    for d in campaign.donations.order_by("created_at").iterator():
        writer.writerow([
            d.public_id,
            timezone.localtime(d.created_at).strftime("%Y-%m-%d %H:%M"),
            d.donor_name,
            d.donor_email,
            f"{d.amount:.2f}",
            d.status,
            d.transaction_ref,
            d.payer_id,
            "yes" if d.is_anonymous else "no",
            d.message,
            timezone.localtime(d.reviewed_at).strftime("%Y-%m-%d %H:%M") if d.reviewed_at else "",
            d.review_note,
        ])
    return response
