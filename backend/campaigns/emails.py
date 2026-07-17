"""Organizer email alerts — branded multipart (HTML + plain text), sent via
the configured backend (Amazon SES in production).

Sending never blocks or breaks the donor's request: the round-trip happens on
a daemon thread and failures only log. Tests send synchronously so
mail.outbox assertions work.
"""

import logging
import threading

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.utils.html import escape

log = logging.getLogger("crowdfund.campaigns")

# Email-client-safe template: table layout, inline styles only.
_HTML_SHELL = """\
<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f3f5f8;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f8;padding:28px 12px;">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0"
       style="width:560px;max-width:100%;background:#ffffff;border:1px solid #e4e8ee;border-radius:5px;overflow:hidden;">
  <tr><td style="background:#0f1220;padding:18px 28px;">
    <span style="font:800 17px 'Segoe UI',Arial,sans-serif;color:#ffffff;">Crowd<span style="color:#34d399;">Fund</span></span>
  </td></tr>
  <tr><td style="padding:28px 28px 8px;">
    <p style="margin:0 0 6px;font:700 12px 'Segoe UI',Arial,sans-serif;letter-spacing:.09em;text-transform:uppercase;color:#059669;">{kicker}</p>
    <p style="margin:0 0 14px;font:800 21px 'Segoe UI',Arial,sans-serif;color:#14171d;line-height:1.35;">{heading}</p>
    <p style="margin:0 0 18px;font:400 14px 'Segoe UI',Arial,sans-serif;color:#3b414d;line-height:1.6;">{intro}</p>
  </td></tr>
  {rows_block}
  {cta_block}
  <tr><td style="padding:6px 28px 26px;">
    <p style="margin:0;font:400 12px 'Segoe UI',Arial,sans-serif;color:#949dae;line-height:1.6;">{footnote}</p>
  </td></tr>
  <tr><td style="background:#f7f8fb;border-top:1px solid #e4e8ee;padding:14px 28px;">
    <p style="margin:0;font:400 12px 'Segoe UI',Arial,sans-serif;color:#949dae;">
      CrowdFund &middot; <a href="{base}" style="color:#4f46e5;text-decoration:none;">crowdfund.doxaed.com</a>
      &middot; direct-to-organizer payments, verified by hand
    </p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>
"""

_ROWS_OPEN = """\
  <tr><td style="padding:0 28px 18px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
         style="border:1px solid #e4e8ee;border-radius:5px;">
"""
_ROW = """\
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid #eef1f5;font:600 12px 'Segoe UI',Arial,sans-serif;color:#5f6a7d;white-space:nowrap;vertical-align:top;">{label}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #eef1f5;font:600 13px 'Segoe UI',Arial,sans-serif;color:#14171d;">{value}</td>
    </tr>
"""
_ROWS_CLOSE = "  </table>\n  </td></tr>\n"

_CTA = """\
  <tr><td style="padding:0 28px 22px;">
    <a href="{url}" style="display:inline-block;background:#4f46e5;color:#ffffff;
       font:600 14px 'Segoe UI',Arial,sans-serif;text-decoration:none;
       padding:12px 26px;border-radius:5px;">{label}</a>
  </td></tr>
"""


def build_branded_email(*, kicker, heading, intro, rows=(), cta=None, footnote=""):
    """Returns (text_body, html_body). `rows` = [(label, value)], cta = (label, url)."""
    rows = [(label, value) for label, value in rows if value]

    text_lines = [intro, ""]
    for label, value in rows:
        text_lines.append(f"{label}: {value}")
    if cta:
        text_lines += ["", f"{cta[0]}:", cta[1]]
    if footnote:
        text_lines += ["", footnote]
    text_lines += ["", "— CrowdFund · crowdfund.doxaed.com"]

    rows_block = ""
    if rows:
        # last row keeps no bottom border
        rendered = [_ROW.format(label=escape(str(l)), value=escape(str(v)))
                    for l, v in rows]
        if rendered:
            rendered[-1] = rendered[-1].replace("border-bottom:1px solid #eef1f5;", "")
        rows_block = _ROWS_OPEN + "".join(rendered) + _ROWS_CLOSE

    cta_block = _CTA.format(url=escape(cta[1]), label=escape(cta[0])) if cta else ""

    html = _HTML_SHELL.format(
        kicker=escape(kicker),
        heading=escape(heading),
        intro=escape(intro),
        rows_block=rows_block,
        cta_block=cta_block,
        footnote=escape(footnote),
        base=settings.PUBLIC_BASE_URL,
    )
    return "\n".join(text_lines), html


def _send(subject, text, html, to):
    try:
        message = EmailMultiAlternatives(subject, text,
                                         settings.DEFAULT_FROM_EMAIL, [to])
        message.attach_alternative(html, "text/html")
        message.send()
    except Exception:
        log.exception("claim alert email failed to=%s", to)


def send_branded(subject, to, **kwargs):
    text, html = build_branded_email(**kwargs)
    if getattr(settings, "TESTING", False):
        _send(subject, text, html, to)
    else:
        threading.Thread(target=_send, args=(subject, text, html, to),
                         daemon=True).start()


def notify_owner_new_claim(donation):
    """'A payment claim just arrived — verify it' alert to the organizer."""
    campaign = donation.campaign
    to = campaign.owner.email
    if not to:
        return

    amount = f"₹{donation.amount:,.0f}"
    rows = [
        ("Supporter", donation.donor_name
                      + (" (asked to appear as Anonymous)" if donation.is_anonymous else "")),
        ("Amount", amount),
        ("UPI transaction ID", donation.transaction_ref),
        ("Payer UPI / phone", donation.payer_id),
        ("Screenshot", "Attached to the claim" if donation.screenshot else "Not provided"),
        ("Message", f"“{donation.message}”" if donation.message else ""),
        ("Reference code", donation.public_id),
    ]

    send_branded(
        f"New {amount} payment claim — {campaign.title}",
        to,
        kicker="New payment claim",
        heading=f"{donation.donor_name} says they paid {amount}",
        intro=f"A new contribution claim just arrived for “{campaign.title}”. "
              "Match it against your account, then confirm or reject it.",
        rows=rows,
        cta=("Verify this claim",
             f"{settings.PUBLIC_BASE_URL}/dashboard/campaigns/{campaign.pk}?tab=verify"),
        footnote="Only verified claims appear on your public supporter wall. "
                 "The screenshot, payer details and reference code are visible "
                 "only to you.",
    )
