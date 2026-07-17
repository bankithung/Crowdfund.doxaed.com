"""PDF receipt rendering (reportlab).

A real file download — window.print() is a dead end in mobile and in-app
browsers. DejaVu Sans gives us the ₹ glyph; if the font files are missing
we fall back to Helvetica and spell out "Rs.".
"""

import logging
from io import BytesIO

from django.conf import settings
from django.utils import timezone

log = logging.getLogger("crowdfund.campaigns")

INK = "#171a26"
MUTED = "#667085"
GREEN = "#0e9f5d"
LINE = "#e4e7ef"

_FONTS = {"regular": "Helvetica", "bold": "Helvetica-Bold",
          "rupee": False, "loaded": False}


def _ensure_fonts():
    if _FONTS["loaded"]:
        return
    _FONTS["loaded"] = True
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    try:
        base = "/usr/share/fonts/truetype/dejavu"
        pdfmetrics.registerFont(TTFont("DejaVu", f"{base}/DejaVuSans.ttf"))
        pdfmetrics.registerFont(TTFont("DejaVu-Bold", f"{base}/DejaVuSans-Bold.ttf"))
        _FONTS.update(regular="DejaVu", bold="DejaVu-Bold", rupee=True)
    except Exception:
        log.info("DejaVu fonts unavailable — PDF receipts fall back to Helvetica/'Rs.'")


def _money(amount):
    text = f"{amount:,.2f}".rstrip("0").rstrip(".")
    return f"₹{text}" if _FONTS["rupee"] else f"Rs. {text}"


def render_receipt_pdf(donation):
    """Returns the receipt as PDF bytes. Confirmed donations only —
    the caller enforces that."""
    _ensure_fonts()
    from reportlab.lib.colors import HexColor
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.utils import simpleSplit
    from reportlab.pdfgen import canvas as pdfcanvas

    campaign = donation.campaign
    tz = timezone.get_current_timezone()
    fmt = lambda dt: dt.astimezone(tz).strftime("%d %b %Y, %I:%M %p") if dt else "—"  # noqa: E731
    regular, bold = _FONTS["regular"], _FONTS["bold"]

    buffer = BytesIO()
    page_w, page_h = A4
    margin = 56
    right = page_w - margin
    c = pdfcanvas.Canvas(buffer, pagesize=A4)
    c.setTitle(f"CrowdFund receipt {donation.public_id}")

    # ------------------------------------------------------------- header
    y = page_h - margin
    c.setFont(bold, 17)
    c.setFillColor(HexColor(INK))
    c.drawString(margin, y, "Crowd")
    c.setFillColor(HexColor(GREEN))
    c.drawString(margin + c.stringWidth("Crowd", bold, 17), y, "Fund")
    c.setFont(bold, 9)
    c.setFillColor(HexColor(MUTED))
    c.drawRightString(right, y + 1, "C O N T R I B U T I O N   R E C E I P T")
    y -= 14
    c.setStrokeColor(HexColor(GREEN))
    c.setLineWidth(2.2)
    c.line(margin, y, right, y)

    # ------------------------------------------------------------- amount
    y -= 44
    c.setFont(bold, 30)
    c.setFillColor(HexColor(GREEN))
    c.drawString(margin, y, _money(donation.amount))
    y -= 20
    c.setFont(regular, 11)
    c.setFillColor(HexColor(MUTED))
    c.drawString(margin, y, "received from")
    c.setFont(bold, 11)
    c.setFillColor(HexColor(INK))
    c.drawString(margin + c.stringWidth("received from ", regular, 11), y,
                 donation.donor_name)
    y -= 22
    c.setFont(bold, 10)
    c.setFillColor(HexColor(GREEN))
    tick = "✓ " if _FONTS["rupee"] else ""
    c.drawString(margin, y, f"{tick}Verified by the organizer")

    # --------------------------------------------------------------- rows
    rows = [("Receipt / reference no.", donation.public_id),
            ("Fundraiser", campaign.title),
            ("Organizer", campaign.owner.name)]
    if donation.transaction_ref:
        rows.append(("UPI transaction ID", donation.transaction_ref))
    if donation.payer_id:
        rows.append(("Paid from (UPI / phone)", donation.payer_id))
    rows += [("Submitted on", fmt(donation.created_at)),
             ("Verified on", fmt(donation.reviewed_at))]

    y -= 26
    for label, value in rows:
        c.setStrokeColor(HexColor(LINE))
        c.setLineWidth(0.7)
        c.line(margin, y, right, y)
        y -= 17
        c.setFont(regular, 10)
        c.setFillColor(HexColor(MUTED))
        c.drawString(margin, y, label)
        c.setFont(bold, 10)
        c.setFillColor(HexColor(INK))
        c.drawRightString(right, y, str(value)[:80])
        y -= 9

    # --------------------------------------------------------------- note
    y -= 22
    note = ("This receipt acknowledges a voluntary contribution paid through UPI "
            "directly to the organizer's account. CrowdFund (crowdfund.doxaed.com) "
            "facilitates verification only and does not collect or hold funds. "
            f"Verify this reference any time at {settings.PUBLIC_BASE_URL}"
            f"/c/{campaign.slug}?ref={donation.public_id}")
    c.setFont(regular, 8.5)
    c.setFillColor(HexColor(MUTED))
    for line in simpleSplit(note, regular, 8.5, right - margin):
        c.drawString(margin, y, line)
        y -= 12

    c.setFont(regular, 8)
    c.drawString(margin, margin - 14,
                 f"Generated {fmt(timezone.now())} · CrowdFund · crowdfund.doxaed.com")
    c.showPage()
    c.save()
    return buffer.getvalue()
