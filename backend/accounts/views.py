import logging

from django.conf import settings
from django.contrib.auth import authenticate, login, logout, update_session_auth_hash
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.tokens import default_token_generator
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import IntegrityError
from django.middleware.csrf import get_token
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from django.views.decorators.csrf import ensure_csrf_cookie

from campaigns.emails import send_branded
from core.api import (BodyError, err, methods, ok, parse_body, rate_limit,
                      require_login, throttle)

from .models import User

log = logging.getLogger("crowdfund.auth")


def send_password_reset_email(user):
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    link = f"{settings.PUBLIC_BASE_URL}/reset-password?uid={uid}&token={token}"
    send_branded(
        "Reset your CrowdFund password",
        user.email,
        kicker="Password reset",
        heading="Reset your password",
        intro=f"Hi {user.name}, we received a request to reset the password for "
              "your CrowdFund organizer account. Use the button below to set a new "
              "one. The link works once and expires in 3 days.",
        cta=("Set a new password", link),
        footnote="Didn't ask for this? You can safely ignore this email — your "
                 "password stays unchanged until you use the link above.",
    )


def user_dict(user):
    return {
        "id": user.pk,
        "name": user.name,
        "email": user.email,
        "date_joined": user.date_joined.isoformat(),
    }


@methods("GET")
@ensure_csrf_cookie
def csrf_view(request):
    # Sets the cf_csrf cookie; the SPA echoes it back in X-CSRFToken.
    return ok({"csrf": get_token(request)})


def _clean_signup(data):
    errors = {}
    name = str(data.get("name") or "").strip()
    email = str(data.get("email") or "").strip().lower()
    password = str(data.get("password") or "")

    if len(name) < 2 or len(name) > 80:
        errors["name"] = "Please enter your name (2–80 characters)."
    if not email or len(email) > 254:
        errors["email"] = "Please enter a valid email address."
    else:
        try:
            validate_email(email)
        except ValidationError:
            errors["email"] = "Please enter a valid email address."
    if "password" not in errors:
        try:
            validate_password(password, user=User(email=email, name=name))
        except ValidationError as exc:
            errors["password"] = " ".join(exc.messages)
    return name, email, password, errors


@methods("POST")
@throttle("signup", limit=10, window_seconds=3600)
def signup_view(request):
    try:
        data = parse_body(request)
    except BodyError as exc:
        return err(str(exc), 400, "bad_body")

    name, email, password, errors = _clean_signup(data)
    if not errors and User.objects.filter(email=email).exists():
        errors["email"] = "An account with this email already exists."
    if errors:
        return err("Please fix the highlighted fields.", 400, "validation", fields=errors)

    try:
        user = User.objects.create_user(email=email, name=name, password=password)
    except IntegrityError:
        return err("Please fix the highlighted fields.", 400, "validation",
                   fields={"email": "An account with this email already exists."})

    login(request, user)
    log.info("signup email=%s id=%s", email, user.pk)
    return ok({"user": user_dict(user)}, status=201)


@methods("POST")
def login_view(request):
    try:
        data = parse_body(request)
    except BodyError as exc:
        return err(str(exc), 400, "bad_body")

    email = str(data.get("email") or "").strip().lower()
    password = str(data.get("password") or "")
    if not email or not password:
        return err("Email and password are required.", 400, "validation")

    if rate_limit(request, "login_ip", 15, 300):
        return err("Too many attempts — please wait a few minutes.", 429, "throttled")
    if rate_limit(request, "login_email", 10, 900, key=email):
        return err("Too many attempts for this account — please wait.", 429, "throttled")

    user = authenticate(request, username=email, password=password)
    if user is None or not user.is_active:
        return err("Invalid email or password.", 400, "bad_credentials")

    login(request, user)
    return ok({"user": user_dict(user)})


@methods("POST")
@require_login
def logout_view(request):
    logout(request)
    return ok({"user": None})


@methods("GET")
@ensure_csrf_cookie
def me_view(request):
    if request.user.is_authenticated:
        return ok({"user": user_dict(request.user)})
    return ok({"user": None})


@methods("POST")
@require_login
@throttle("pwchange", limit=10, window_seconds=3600, per="user")
def change_password_view(request):
    try:
        data = parse_body(request)
    except BodyError as exc:
        return err(str(exc), 400, "bad_body")

    current = str(data.get("current_password") or "")
    new = str(data.get("new_password") or "")
    if not request.user.check_password(current):
        return err("Current password is incorrect.", 400, "validation",
                   fields={"current_password": "Current password is incorrect."})
    try:
        validate_password(new, user=request.user)
    except ValidationError as exc:
        return err("Please choose a stronger password.", 400, "validation",
                   fields={"new_password": " ".join(exc.messages)})

    request.user.set_password(new)
    request.user.save(update_fields=["password"])
    update_session_auth_hash(request, request.user)
    return ok({"user": user_dict(request.user)})


# ----------------------------------------------------- forgotten password

@methods("POST")
def password_reset_request_view(request):
    """Email a reset link. Always reports success — never reveals whether an
    account exists for the address (no user enumeration)."""
    try:
        data = parse_body(request)
    except BodyError as exc:
        return err(str(exc), 400, "bad_body")

    email = str(data.get("email") or "").strip().lower()
    if not email:
        return err("Enter your email address.", 400, "validation",
                   fields={"email": "Enter your email address."})

    # Rate-limit so this can't be used to blast a mailbox or probe accounts.
    if rate_limit(request, "pwreset_ip", 5, 900):
        return err("Too many requests — please wait a few minutes.", 429, "throttled")
    rate_limit(request, "pwreset_email", 3, 900, key=email)

    user = User.objects.filter(email__iexact=email, is_active=True).first()
    if user:
        send_password_reset_email(user)
    return ok({"sent": True})


@methods("POST")
def password_reset_confirm_view(request):
    """Set a new password from a valid reset link (uid + token)."""
    try:
        data = parse_body(request)
    except BodyError as exc:
        return err(str(exc), 400, "bad_body")

    if rate_limit(request, "pwreset_confirm_ip", 15, 900):
        return err("Too many attempts — please wait a few minutes.", 429, "throttled")

    uidb64 = str(data.get("uid") or "")
    token = str(data.get("token") or "")
    new = str(data.get("new_password") or "")

    user = None
    try:
        pk = urlsafe_base64_decode(uidb64).decode()
        user = User.objects.get(pk=pk, is_active=True)
    except (TypeError, ValueError, OverflowError, User.DoesNotExist):
        user = None

    if user is None or not default_token_generator.check_token(user, token):
        return err("This reset link is invalid or has expired. Request a new one.",
                   400, "invalid_token")

    try:
        validate_password(new, user=user)
    except ValidationError as exc:
        return err("Please choose a stronger password.", 400, "validation",
                   fields={"new_password": " ".join(exc.messages)})

    user.set_password(new)          # invalidates the token (password hash changes)
    user.save(update_fields=["password"])
    log.info("password reset completed for user=%s", user.pk)
    return ok({"reset": True})
