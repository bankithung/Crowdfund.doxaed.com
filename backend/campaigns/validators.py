"""Field validation for campaign create/update and donation submission."""

import datetime
import re
from decimal import Decimal, InvalidOperation

from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.utils import timezone

from .models import CATEGORY_CHOICES

UPI_RE = re.compile(r"^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9]{1,31}$")
TXN_REF_RE = re.compile(r"^[A-Za-z0-9\-_. ]{4,64}$")
PHONE_RE = re.compile(r"^[6-9]\d{9}$")
CATEGORY_KEYS = {key for key, _ in CATEGORY_CHOICES}

GOAL_MIN = Decimal("100")
GOAL_MAX = Decimal("1000000000")        # ₹100 crore
DONATION_MIN = Decimal("1")
DONATION_MAX = Decimal("10000000")      # ₹1 crore per claim


def parse_amount(raw, lo, hi, label):
    try:
        value = Decimal(str(raw).replace(",", "").strip())
    except (InvalidOperation, TypeError):
        raise ValidationError(f"Enter a valid {label}.")
    if value != value.quantize(Decimal("0.01")):
        raise ValidationError(f"{label.capitalize()} can have at most 2 decimal places.")
    value = value.quantize(Decimal("0.01"))
    if value < lo or value > hi:
        raise ValidationError(f"{label.capitalize()} must be between ₹{lo:,.0f} and ₹{hi:,.0f}.")
    return value


def clean_campaign_fields(data, *, partial):
    """Returns (cleaned_dict, errors_dict). Only keys present in `data` are
    validated when partial=True."""
    cleaned, errors = {}, {}

    def has(field):
        return not partial or field in data

    if has("title"):
        title = str(data.get("title") or "").strip()
        if not 4 <= len(title) <= 90:
            errors["title"] = "Title must be 4–90 characters."
        else:
            cleaned["title"] = title

    if has("tagline"):
        tagline = str(data.get("tagline") or "").strip()
        if len(tagline) > 160:
            errors["tagline"] = "Tagline must be at most 160 characters."
        else:
            cleaned["tagline"] = tagline

    if has("description"):
        description = str(data.get("description") or "").strip()
        if not 20 <= len(description) <= 8000:
            errors["description"] = "Story must be 20–8000 characters."
        else:
            cleaned["description"] = description

    if has("category"):
        category = str(data.get("category") or "other").strip().lower()
        if category not in CATEGORY_KEYS:
            errors["category"] = "Pick a valid category."
        else:
            cleaned["category"] = category

    if has("goal_amount"):
        try:
            cleaned["goal_amount"] = parse_amount(data.get("goal_amount"),
                                                  GOAL_MIN, GOAL_MAX, "goal amount")
        except ValidationError as exc:
            errors["goal_amount"] = exc.messages[0]

    if has("upi_id"):
        upi = str(data.get("upi_id") or "").strip()
        if upi and not UPI_RE.match(upi):
            errors["upi_id"] = "That doesn't look like a valid UPI ID (e.g. name@bank)."
        else:
            cleaned["upi_id"] = upi

    if has("payee_name"):
        payee = str(data.get("payee_name") or "").strip()
        if len(payee) > 80:
            errors["payee_name"] = "Payee name must be at most 80 characters."
        else:
            cleaned["payee_name"] = payee

    if has("end_date"):
        raw = str(data.get("end_date") or "").strip()
        if not raw:
            cleaned["end_date"] = None
        else:
            try:
                end = datetime.date.fromisoformat(raw)
            except ValueError:
                errors["end_date"] = "Use the YYYY-MM-DD date format."
            else:
                if end < timezone.localdate():
                    errors["end_date"] = "End date can't be in the past."
                elif end > timezone.localdate() + datetime.timedelta(days=366 * 5):
                    errors["end_date"] = "End date is too far in the future."
                else:
                    cleaned["end_date"] = end

    return cleaned, errors


def clean_donation_fields(data):
    cleaned, errors = {}, {}

    name = str(data.get("donor_name") or "").strip()
    if not 2 <= len(name) <= 60:
        errors["donor_name"] = "Please enter your name (2–60 characters)."
    else:
        cleaned["donor_name"] = name

    email = str(data.get("donor_email") or "").strip().lower()
    if email:
        try:
            validate_email(email)
            cleaned["donor_email"] = email[:254]
        except ValidationError:
            errors["donor_email"] = "Please enter a valid email (or leave it empty)."
    else:
        cleaned["donor_email"] = ""

    try:
        cleaned["amount"] = parse_amount(data.get("amount"),
                                         DONATION_MIN, DONATION_MAX, "amount")
    except ValidationError as exc:
        errors["amount"] = exc.messages[0]

    message = str(data.get("message") or "").strip()
    if len(message) > 280:
        errors["message"] = "Message must be at most 280 characters."
    else:
        cleaned["message"] = message

    ref = str(data.get("transaction_ref") or "").strip()
    if ref and not TXN_REF_RE.match(ref):
        errors["transaction_ref"] = "Transaction ID should be 4–64 letters, digits or dashes."
    else:
        cleaned["transaction_ref"] = ref

    payer = str(data.get("payer_id") or "").strip()
    if payer and not (UPI_RE.match(payer) or PHONE_RE.match(payer)):
        errors["payer_id"] = "Enter a valid UPI ID (name@bank) or 10-digit mobile number."
    else:
        cleaned["payer_id"] = payer

    return cleaned, errors
