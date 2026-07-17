"""Organizer email alerts (Amazon SES via SMTP — see core/settings.py).

Sending never blocks or breaks the donor's request: the SMTP round-trip
happens on a daemon thread and failures only log. Tests send synchronously
so mail.outbox assertions work.
"""

import logging
import threading

from django.conf import settings
from django.core.mail import send_mail

log = logging.getLogger("crowdfund.campaigns")


def _send(subject, body, to):
    try:
        send_mail(subject, body, settings.DEFAULT_FROM_EMAIL, [to])
    except Exception:
        log.exception("claim alert email failed to=%s", to)


def notify_owner_new_claim(donation):
    """'A payment claim just arrived — verify it' alert to the organizer."""
    campaign = donation.campaign
    to = campaign.owner.email
    if not to:
        return

    amount = f"₹{donation.amount:,.0f}"
    subject = f"New {amount} payment claim — {campaign.title}"

    lines = [
        f"{donation.donor_name} says they paid {amount} to “{campaign.title}”.",
        "",
        f"Reference code: {donation.public_id}",
    ]
    if donation.transaction_ref:
        lines.append(f"UPI transaction ID: {donation.transaction_ref}")
    if donation.payer_id:
        lines.append(f"Payer UPI/phone: {donation.payer_id}")
    lines.append("Payment screenshot: " +
                 ("attached to the claim" if donation.screenshot else "not provided"))
    if donation.message:
        lines.append(f"Message: “{donation.message}”")
    if donation.is_anonymous:
        lines.append("The supporter asked to appear as Anonymous on the wall.")
    lines += [
        "",
        "Check your account, then verify the claim here:",
        f"{settings.PUBLIC_BASE_URL}/dashboard/campaigns/{campaign.pk}?tab=verify",
        "",
        "— CrowdFund · crowdfund.doxaed.com",
    ]
    body = "\n".join(lines)

    if getattr(settings, "TESTING", False):
        _send(subject, body, to)
    else:
        threading.Thread(target=_send, args=(subject, body, to), daemon=True).start()
