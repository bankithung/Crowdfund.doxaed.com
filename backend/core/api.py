"""Small, explicit API toolkit: JSON envelopes, method routing, auth guard,
fixed-window rate limiting backed by the shared database cache."""

import functools
import json
import math
import time

from django.core.cache import cache
from django.http import JsonResponse


def ok(data=None, status=200):
    return JsonResponse({"ok": True, "data": data}, status=status)


def err(message, status=400, code="error", fields=None):
    payload = {"ok": False, "error": {"code": code, "message": message}}
    if fields:
        payload["error"]["fields"] = fields
    return JsonResponse(payload, status=status)


class BodyError(ValueError):
    pass


def parse_body(request):
    """Return a dict-like of submitted fields for JSON or form/multipart bodies."""
    ctype = (request.content_type or "").lower()
    if ctype.startswith("application/json"):
        try:
            data = json.loads(request.body.decode("utf-8") or "{}")
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise BodyError("Request body is not valid JSON.")
        if not isinstance(data, dict):
            raise BodyError("Request body must be a JSON object.")
        return data
    return request.POST


def methods(*allowed):
    """Restrict a view to the given HTTP methods (405 otherwise)."""
    allowed = {m.upper() for m in allowed}

    def decorator(view):
        @functools.wraps(view)
        def wrapper(request, *args, **kwargs):
            if request.method not in allowed:
                response = err("Method not allowed.", 405, "method_not_allowed")
                response["Allow"] = ", ".join(sorted(allowed))
                return response
            return view(request, *args, **kwargs)

        return wrapper

    return decorator


def require_login(view):
    @functools.wraps(view)
    def wrapper(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return err("You need to be signed in.", 401, "auth_required")
        return view(request, *args, **kwargs)

    return wrapper


def client_ip(request):
    # nginx overwrites X-Forwarded-For with the real client address, so the
    # first entry is trustworthy in production; fall back to REMOTE_ADDR.
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if forwarded:
        return forwarded.split(",")[0].strip()[:64]
    return request.META.get("REMOTE_ADDR", "0.0.0.0")


def rate_limit(request, scope, limit, window_seconds, key=None):
    """Fixed-window counter. Returns True when the caller is over the limit."""
    ident = key if key is not None else client_ip(request)
    bucket = int(time.time() // window_seconds)
    cache_key = f"rl:{scope}:{ident}:{bucket}"
    try:
        count = cache.incr(cache_key)
    except ValueError:
        cache.add(cache_key, 1, timeout=window_seconds * 2)
        count = 1
    return count > limit


def throttle(scope, limit, window_seconds, per="ip"):
    """Decorator form of rate_limit; per='user' keys on the signed-in user."""

    def decorator(view):
        @functools.wraps(view)
        def wrapper(request, *args, **kwargs):
            if per == "user" and request.user.is_authenticated:
                ident = f"u{request.user.pk}"
            else:
                ident = client_ip(request)
            if rate_limit(request, scope, limit, window_seconds, key=ident):
                return err("Too many requests — please wait a moment and try again.",
                           429, "throttled")
            return view(request, *args, **kwargs)

        return wrapper

    return decorator


def paginate(queryset, request, default_size=20, max_size=50):
    try:
        page = max(int(request.GET.get("page", 1)), 1)
    except (TypeError, ValueError):
        page = 1
    try:
        size = min(max(int(request.GET.get("page_size", default_size)), 1), max_size)
    except (TypeError, ValueError):
        size = default_size
    total = queryset.count()
    pages = max(math.ceil(total / size), 1)
    page = min(page, pages)
    start = (page - 1) * size
    items = list(queryset[start:start + size])
    return items, {"page": page, "pages": pages, "total": total, "page_size": size}


def as_bool(value):
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}
