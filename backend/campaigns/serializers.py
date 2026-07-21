"""Plain-dict serializers. Public payloads never leak owner email, donor
emails, IPs, or proof URLs."""

from django.conf import settings
from django.db.models import Avg, Count, Max, Q, Sum
from django.utils import timezone


def share_url(campaign):
    return f"{settings.PUBLIC_BASE_URL}/c/{campaign.slug}"


def money(value):
    return float(value) if value is not None else 0.0


def campaign_counters(campaign):
    """Confirmed/pending stats; uses queryset annotations when present."""
    if hasattr(campaign, "raised"):
        raised = money(campaign.raised)
        confirmed = campaign.confirmed_count
        pending = campaign.pending_count
    else:
        agg = campaign.donations.aggregate(
            raised=Sum("amount", filter=Q(status="confirmed")),
            confirmed=Count("id", filter=Q(status="confirmed")),
            pending=Count("id", filter=Q(status="pending")),
        )
        raised = money(agg["raised"])
        confirmed = agg["confirmed"] or 0
        pending = agg["pending"] or 0

    goal = money(campaign.goal_amount)
    progress = round((raised / goal) * 100, 1) if goal else 0.0
    return {
        "raised": raised,
        "goal": goal,
        "progress": min(progress, 999.0),
        "donors": confirmed,
        "pending": pending,
    }


def days_left(campaign):
    if not campaign.end_date:
        return None
    return (campaign.end_date - timezone.localdate()).days


def impact_dict(campaign, raised):
    """Public impact block: how much of the real-world goal ('75,000 kg of
    cabbage secured') the verified funds translate to."""
    if not campaign.impact_enabled:
        return None

    basis = raised
    if campaign.impact_funds_basis == "eligible":
        basis = max(0.0, raised - money(campaign.impact_expenses))
    elif campaign.impact_funds_basis == "percent":
        basis = raised * campaign.impact_funds_percent / 100.0

    if campaign.impact_mode == "manual":
        secured = money(campaign.impact_manual_value)
    else:
        conv_rupees = money(campaign.impact_conv_rupees)
        conv_units = money(campaign.impact_conv_units) or 1.0
        secured = round(basis / conv_rupees * conv_units, 1) if conv_rupees else 0.0
    if secured == int(secured):
        secured = int(secured)

    target = money(campaign.impact_target)
    last_verified = (campaign.donations.filter(status="confirmed")
                     .exclude(reviewed_at=None)
                     .order_by("-reviewed_at")
                     .values_list("reviewed_at", flat=True).first())
    stamps = [ts for ts in (campaign.impact_updated_at,
                            last_verified if campaign.impact_mode == "auto" else None)
              if ts]

    return {
        "item": campaign.impact_item,
        "unit": campaign.impact_unit,
        "action": campaign.impact_action,
        "target": target,
        "secured": secured,
        "progress": min(round((secured / target) * 100, 1) if target else 0.0, 999.0),
        "mode": campaign.impact_mode,
        "basis_funds": round(basis, 2),
        "default_view": campaign.impact_default_view,
        "completed": ({
            "action": campaign.impact_completed_action,
            "qty": money(campaign.impact_completed_qty),
        } if campaign.impact_completed_enabled else None),
        "updated_at": max(stamps).isoformat() if stamps else None,
    }


IMPACT_SETTINGS_FIELDS = (
    "impact_enabled", "impact_item", "impact_unit", "impact_action",
    "impact_target", "impact_mode", "impact_conv_rupees", "impact_conv_units",
    "impact_funds_basis", "impact_expenses", "impact_funds_percent",
    "impact_manual_value", "impact_default_view", "impact_completed_enabled",
    "impact_completed_action", "impact_completed_qty",
)


def impact_settings_dict(campaign):
    """Raw impact configuration — the organizer's settings form."""
    data = {}
    for field in IMPACT_SETTINGS_FIELDS:
        value = getattr(campaign, field)
        if hasattr(value, "quantize"):                    # Decimal → float
            value = money(value)
        data[field] = value
    return data


def campaign_qrs(campaign, *, private):
    """Unified list of the campaign's payment QR codes — the primary (id 0)
    plus any extras — each with today's confirmed receipts against its daily
    cap. Amounts/limits are exposed publicly only when show_amounts is on;
    'is_full' is always exposed so donors can be routed off a maxed-out code."""
    today = timezone.localdate()
    rows = (campaign.donations
            .filter(status="confirmed", created_at__date=today)
            .values("qr_id").annotate(total=Sum("amount")))
    received = {r["qr_id"]: money(r["total"]) for r in rows}
    reveal = private or campaign.show_amounts

    def entry(qr_id, label, url, payload, upi, payee, limit):
        got = received.get(qr_id, 0.0)
        cap = money(limit) if limit is not None else None
        item = {
            "id": qr_id or 0,
            "label": label,
            "url": url,
            "qr_payload": payload,
            "upi_id": upi,
            "payee_name": payee or campaign.owner.name,
            "is_full": bool(cap and got >= cap),
        }
        if reveal:
            item["daily_limit"] = cap
            item["received_today"] = round(got, 2)
            item["remaining_today"] = round(max(0.0, cap - got), 2) if cap else None
        return item

    qrs = [entry(None, campaign.qr_label, campaign.qr_code.url if campaign.qr_code else None,
                 campaign.qr_payload, campaign.upi_id, campaign.payee_name,
                 campaign.qr_daily_limit)]
    for extra in campaign.extra_qrs.all():
        qrs.append(entry(extra.pk, extra.label, extra.image.url, extra.qr_payload,
                         extra.upi_id, extra.payee_name, extra.daily_limit))
    return qrs


def campaign_dict(campaign, *, private=False):
    data = {
        "id": campaign.pk,
        "title": campaign.title,
        "slug": campaign.slug,
        "tagline": campaign.tagline,
        "description": campaign.description,
        "category": campaign.category,
        "category_label": campaign.get_category_display(),
        "currency": campaign.currency,
        "qr_url": campaign.qr_code.url if campaign.qr_code else None,
        "qr_payload": campaign.qr_payload,
        "cover_url": campaign.cover_image.url if campaign.cover_image else None,
        "gallery": (
            ([{"id": 0, "url": campaign.cover_image.url}] if campaign.cover_image else [])
            + [{"id": img.pk, "url": img.image.url} for img in campaign.images.all()]
        ),
        "upi_id": campaign.upi_id,
        "payee_name": campaign.payee_name or campaign.owner.name,
        "qrs": campaign_qrs(campaign, private=private),
        "organizer": campaign.owner.name,
        "organizer_verified": campaign.owner.is_verified,
        "status": campaign.status,
        "show_amounts": campaign.show_amounts,
        "end_date": campaign.end_date.isoformat() if campaign.end_date else None,
        "days_left": days_left(campaign),
        "created_at": campaign.created_at.isoformat(),
        "share_url": share_url(campaign),
        "stats": campaign_counters(campaign),
        "fund_uses": [
            {"id": use.pk, "heading": use.heading,
             "images": [{"id": img.pk, "url": img.image.url,
                         "caption": img.caption}
                        for img in use.images.all()]}
            for use in campaign.fund_uses.prefetch_related("images")
        ],
    }
    data["impact"] = impact_dict(campaign, data["stats"]["raised"])
    if private:
        data["views"] = campaign.views
        data["impact_settings"] = impact_settings_dict(campaign)
    return data


def donation_admin_dict(donation):
    return {
        "id": donation.pk,
        "public_id": donation.public_id,
        "donor_name": donation.donor_name,
        "donor_email": donation.donor_email,
        "amount": money(donation.amount),
        "message": donation.message,
        "is_anonymous": donation.is_anonymous,
        "transaction_ref": donation.transaction_ref,
        "payer_id": donation.payer_id,
        "qr_id": donation.qr_id or 0,
        "has_screenshot": bool(donation.screenshot),
        "proof_url": f"/api/donations/{donation.pk}/proof/" if donation.screenshot else None,
        "status": donation.status,
        "review_note": donation.review_note,
        "created_at": donation.created_at.isoformat(),
        "reviewed_at": donation.reviewed_at.isoformat() if donation.reviewed_at else None,
        "campaign_id": donation.campaign_id,
    }


def donor_public_dict(donation, show_amounts):
    return {
        "name": "Anonymous" if donation.is_anonymous else donation.donor_name,
        "amount": money(donation.amount) if show_amounts else None,
        "message": donation.message,
        "date": donation.created_at.isoformat(),
    }


def analytics_dict(campaign, series, recent):
    agg = campaign.donations.aggregate(
        raised=Sum("amount", filter=Q(status="confirmed")),
        confirmed=Count("id", filter=Q(status="confirmed")),
        pending=Count("id", filter=Q(status="pending")),
        rejected=Count("id", filter=Q(status="rejected")),
        avg=Avg("amount", filter=Q(status="confirmed")),
        top=Max("amount", filter=Q(status="confirmed")),
    )
    raised = money(agg["raised"])
    goal = money(campaign.goal_amount)
    donors = agg["confirmed"] or 0
    views = campaign.views or 0
    return {
        "raised": raised,
        "goal": goal,
        "progress": min(round((raised / goal) * 100, 1) if goal else 0.0, 999.0),
        "donors": donors,
        "pending": agg["pending"] or 0,
        "rejected": agg["rejected"] or 0,
        "average": round(money(agg["avg"]), 2),
        "top": money(agg["top"]),
        "views": views,
        "conversion": round((donors / views) * 100, 1) if views else 0.0,
        "days_left": days_left(campaign),
        "series": series,
        "recent": recent,
        "share_url": share_url(campaign),
    }
