"""Best-effort OCR over payment screenshots so the claim form can prefill
the transaction ID, amount, and the payer's UPI ID. Extraction only — the
organizer still verifies every claim manually."""

import logging
import re

from PIL import Image, ImageOps

log = logging.getLogger("crowdfund.ocr")

# Labels UPI apps print next to the reference number.
_UTR_LABELLED = re.compile(
    r"(?:UTR|UPI\s*transaction\s*ID|UPI\s*Ref(?:erence)?\s*(?:No|Number|ID)?|"
    r"Transaction\s*ID|Ref(?:erence)?\s*(?:No|Number|ID))\s*[:#.\-]?\s*([A-Z0-9]{10,25})",
    re.IGNORECASE)
_UTR_BARE = re.compile(r"\b(\d{12})\b")
# ₹ often OCRs as %, z, =, #, F, X or vanishes — so amount detection is
# layered: explicit marker, label words, then a big-standalone-number pass.
_AMOUNT_MARKED = re.compile(
    r"(?:₹|Rs\.?|INR|Re\.)[^\d\n]{0,3}([\d,]{1,12}(?:\.\d{1,2})?)", re.IGNORECASE)
_AMOUNT_LABEL = re.compile(
    r"(?:amount|paid|payment\s*(?:of)?|sent|received)\D{0,12}"
    r"([\d,]{1,12}(?:\.\d{1,2})?)", re.IGNORECASE)
_AMOUNT_LINE = re.compile(r"^[^\w\n]{0,3}(\d[\d,]{0,11}(?:\.\d{1,2})?)[^\w\n]{0,3}$")
_NUM_TOKEN = re.compile(r"\d[\d,]*\.\d{1,2}")
_VPA = re.compile(r"\b([A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9]{1,31})\b")
_PHONE = re.compile(r"\b([6-9]\d{9})\b")
# Sender name lines ("From: Ravi Kumar", "Paid by Ravi Kumar", ...). Only
# accepted when it looks like a real full name (contains a space).
_NAME = re.compile(
    r"(?:From|Paid\s+by|Sender|Debited\s+from)\s*[:\-]?\s*"
    r"([A-Za-z][A-Za-z .'()-]{2,40})", re.IGNORECASE)


def _ocr_text(image):
    import pytesseract

    prepared = ImageOps.autocontrast(image.convert("L"))
    if max(prepared.size) < 1000:
        scale = 1000 / max(prepared.size)
        prepared = prepared.resize(
            (int(prepared.width * scale), int(prepared.height * scale)),
            Image.LANCZOS)
    return pytesseract.image_to_string(prepared)


def _amount_ok(token, utr):
    digits = token.replace(",", "").replace(".", "")
    plain = token.replace(",", "")
    if utr and digits in utr:
        return False
    if len(digits) == 12:                       # a UTR, not money
        return False
    if len(digits) == 10 and digits[0] in "6789" and "." not in token:
        return False                            # phone number
    try:
        value = float(plain)
    except ValueError:
        return False
    if "." not in token and "," not in token and 1900 <= value <= 2099 and len(digits) == 4:
        return False                            # looks like a year
    return 1 <= value <= 10_000_000


def _pick_amount(text, utr):
    for pattern in (_AMOUNT_MARKED, _AMOUNT_LABEL):
        for match in pattern.finditer(text):
            token = match.group(1)
            if _amount_ok(token, utr):
                return token.replace(",", "")
    # amount displayed big on its own line (marker lost by OCR)
    for line in text.splitlines():
        match = _AMOUNT_LINE.match(line.strip())
        if match and _amount_ok(match.group(1), utr):
            return match.group(1).replace(",", "")
    # any decimal-bearing number (e.g. "500.00") anywhere
    for token in _NUM_TOKEN.findall(text):
        if _amount_ok(token, utr):
            return token.replace(",", "")
    return ""


def parse_payment_screenshot(file_obj, exclude_vpas=()):
    """Returns {'transaction_ref', 'amount', 'payer_id', 'payer_name'}
    (values may be '')."""
    result = {"transaction_ref": "", "amount": "", "payer_id": "", "payer_name": ""}
    try:
        image = Image.open(file_obj)
        image.load()
        text = _ocr_text(image)
    except Exception as exc:
        log.info("ocr failed: %s", exc)
        return result

    labelled = _UTR_LABELLED.search(text)
    if labelled:
        result["transaction_ref"] = labelled.group(1).strip()
    else:
        bare = _UTR_BARE.search(text)
        if bare:
            result["transaction_ref"] = bare.group(1)

    result["amount"] = _pick_amount(text, result["transaction_ref"])

    excluded = {v.lower() for v in exclude_vpas if v}
    for vpa in _VPA.findall(text):
        if vpa.lower() not in excluded:
            result["payer_id"] = vpa
            break
    if not result["payer_id"]:
        phone = _PHONE.search(text)
        if phone and phone.group(1) != result["transaction_ref"]:
            result["payer_id"] = phone.group(1)

    for name in _NAME.findall(text):
        candidate = name.strip(" .-")
        # full names only; VPA captures ("donorperson" from x@ybl) have no space
        if " " in candidate and "@" not in candidate and not any(c.isdigit() for c in candidate):
            result["payer_name"] = candidate[:60]
            break

    return result
