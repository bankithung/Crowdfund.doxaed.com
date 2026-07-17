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


IMPACT_MODES = {"auto", "manual"}
IMPACT_BASES = {"eligible", "all", "percent"}
IMPACT_VIEWS = {"funds", "impact"}


def clean_impact_fields(data):
    """Partial validation for the impact-tracking settings — only keys
    present in `data` are validated/returned. Booleans are handled by the
    view (as_bool); this covers the typed fields."""
    cleaned, errors = {}, {}

    def text(key, label, max_len):
        value = str(data.get(key) or "").strip()
        if len(value) > max_len:
            errors[key] = f"{label} must be at most {max_len} characters."
        else:
            cleaned[key] = value

    if "impact_item" in data:
        text("impact_item", "Impact item", 40)
    if "impact_unit" in data:
        text("impact_unit", "Unit", 20)
    if "impact_action" in data:
        text("impact_action", "Action word", 30)
    if "impact_completed_action" in data:
        text("impact_completed_action", "Completed action word", 30)

    def amount(key, label, lo, hi, empty):
        """Empty input means 'not set' — mapped to the field's natural
        empty value, never a validation error (the form always submits
        every field, including hidden ones)."""
        raw = str(data.get(key) or "").strip()
        if not raw:
            cleaned[key] = empty
            return
        try:
            cleaned[key] = parse_amount(raw, lo, hi, label)
        except ValidationError as exc:
            errors[key] = exc.messages[0]

    if "impact_target" in data:
        amount("impact_target", "impact target",
               Decimal("1"), Decimal("1000000000"), None)
    if "impact_conv_rupees" in data:
        amount("impact_conv_rupees", "conversion amount",
               Decimal("0.01"), Decimal("100000000"), None)
    if "impact_conv_units" in data:
        amount("impact_conv_units", "conversion quantity",
               Decimal("0.01"), Decimal("100000000"), None)
    if "impact_expenses" in data:
        amount("impact_expenses", "expenses",
               Decimal("0"), Decimal("1000000000"), Decimal("0"))
    if "impact_manual_value" in data:
        amount("impact_manual_value", "impact value",
               Decimal("0"), Decimal("1000000000"), Decimal("0"))
    if "impact_completed_qty" in data:
        amount("impact_completed_qty", "completed quantity",
               Decimal("0"), Decimal("1000000000"), Decimal("0"))

    if "impact_mode" in data:
        mode = str(data.get("impact_mode") or "").strip().lower()
        if mode not in IMPACT_MODES:
            errors["impact_mode"] = "Choose automatic or manual."
        else:
            cleaned["impact_mode"] = mode

    if "impact_funds_basis" in data:
        basis = str(data.get("impact_funds_basis") or "").strip().lower()
        if basis not in IMPACT_BASES:
            errors["impact_funds_basis"] = "Choose which funds count."
        else:
            cleaned["impact_funds_basis"] = basis

    if "impact_funds_percent" in data:
        raw = str(data.get("impact_funds_percent") or "").strip()
        if not raw:
            cleaned["impact_funds_percent"] = 100
        else:
            try:
                percent = int(raw)
                if not 1 <= percent <= 100:
                    raise ValueError
                cleaned["impact_funds_percent"] = percent
            except (TypeError, ValueError):
                errors["impact_funds_percent"] = "Percentage must be between 1 and 100."

    if "impact_default_view" in data:
        view = str(data.get("impact_default_view") or "").strip().lower()
        if view not in IMPACT_VIEWS:
            errors["impact_default_view"] = "Choose funds or impact."
        else:
            cleaned["impact_default_view"] = view

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
