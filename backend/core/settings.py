"""
Django settings for the CrowdFund platform (crowdfund.doxaed.com).

Production-hardened: secrets come from backend/.env (chmod 600), Argon2
password hashing, secure session/CSRF cookies (activated once HTTPS_ENABLED
is flipped by the auto-SSL unit), database-backed cache shared across
gunicorn workers for rate limiting.
"""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent          # backend/
PROJECT_ROOT = BASE_DIR.parent                              # Crowdfund.doxaed.com/


def _load_env(path):
    """Tiny .env loader — no third-party dependency."""
    try:
        for raw in Path(path).read_text().splitlines():
            line = raw.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                os.environ.setdefault(key.strip(), value.strip())
    except FileNotFoundError:
        pass


_load_env(BASE_DIR / ".env")

SECRET_KEY = os.environ["DJANGO_SECRET_KEY"]
DEBUG = os.environ.get("DJANGO_DEBUG", "false").lower() == "true"
HTTPS_ENABLED = os.environ.get("HTTPS_ENABLED", "false").lower() == "true"

DOMAIN = os.environ.get("DOMAIN", "crowdfund.doxaed.com")
SERVER_IP = os.environ.get("SERVER_IP", "")

ALLOWED_HOSTS = [DOMAIN, "localhost", "127.0.0.1"]
if SERVER_IP:
    ALLOWED_HOSTS.append(SERVER_IP)

CSRF_TRUSTED_ORIGINS = [f"https://{DOMAIN}", f"http://{DOMAIN}"]
if SERVER_IP:
    CSRF_TRUSTED_ORIGINS += [f"http://{SERVER_IP}", f"https://{SERVER_IP}"]

# Canonical absolute base URL used in share links / OG tags.
if HTTPS_ENABLED:
    PUBLIC_BASE_URL = f"https://{DOMAIN}"
else:
    PUBLIC_BASE_URL = f"http://{SERVER_IP or DOMAIN}"

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "accounts",
    "campaigns",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "core.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "core.wsgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ.get("DB_NAME", "crowdfund"),
        "USER": os.environ.get("DB_USER", "crowdfund"),
        "PASSWORD": os.environ.get("DB_PASSWORD", ""),
        "HOST": os.environ.get("DB_HOST", "127.0.0.1"),
        "PORT": os.environ.get("DB_PORT", "5432"),
        "CONN_MAX_AGE": 60,
    }
}

# Shared across gunicorn workers — used for rate limiting counters.
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.db.DatabaseCache",
        "LOCATION": "cache_table",
        "TIMEOUT": 300,
        "OPTIONS": {"MAX_ENTRIES": 20000, "CULL_FREQUENCY": 4},
    }
}

AUTH_USER_MODEL = "accounts.User"

PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2SHA1PasswordHasher",
    "django.contrib.auth.hashers.ScryptPasswordHasher",
]

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
     "OPTIONS": {"min_length": 8}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# ---------------------------------------------------------------- sessions
SESSION_COOKIE_AGE = 60 * 60 * 24 * 14          # 14 days
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_NAME = "cf_session"
CSRF_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_HTTPONLY = False                     # SPA reads it to echo in X-CSRFToken
CSRF_COOKIE_NAME = "cf_csrf"

if HTTPS_ENABLED:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = 60 * 60 * 24 * 180
    SECURE_HSTS_INCLUDE_SUBDOMAINS = False       # other doxaed.com subdomains are not ours
    SECURE_HSTS_PRELOAD = False

SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"

# ---------------------------------------------------------------- email
# New-claim alerts to organizers, sent through Amazon SES's SMTP interface.
# Configure in backend/.env:
#   EMAIL_HOST=email-smtp.ap-south-1.amazonaws.com
#   EMAIL_HOST_USER=<SES SMTP username>
#   EMAIL_HOST_PASSWORD=<SES SMTP password>
#   DEFAULT_FROM_EMAIL=CrowdFund <no-reply@doxaed.com>   (a SES-verified sender)
# Without EMAIL_HOST, mail goes to the console log instead of being sent.
EMAIL_HOST = os.environ.get("EMAIL_HOST", "")
if EMAIL_HOST:
    EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
    EMAIL_PORT = int(os.environ.get("EMAIL_PORT", "587"))
    EMAIL_HOST_USER = os.environ.get("EMAIL_HOST_USER", "")
    EMAIL_HOST_PASSWORD = os.environ.get("EMAIL_HOST_PASSWORD", "")
    EMAIL_USE_TLS = os.environ.get("EMAIL_USE_TLS", "true").lower() == "true"
    EMAIL_TIMEOUT = 10
else:
    EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
DEFAULT_FROM_EMAIL = os.environ.get("DEFAULT_FROM_EMAIL", f"CrowdFund <no-reply@{DOMAIN}>")

# ---------------------------------------------------------------- i18n
LANGUAGE_CODE = "en-us"
TIME_ZONE = "Asia/Kolkata"
USE_I18N = True
USE_TZ = True

# ---------------------------------------------------------------- static & media
STATIC_URL = "/django-static/"
STATIC_ROOT = PROJECT_ROOT / "staticfiles"
MEDIA_URL = "/media/"
MEDIA_ROOT = PROJECT_ROOT / "media"

FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"

# Uploaded files must be readable by nginx (www-data) for /media/qr.
FILE_UPLOAD_PERMISSIONS = 0o644
FILE_UPLOAD_DIRECTORY_PERMISSIONS = 0o755
DATA_UPLOAD_MAX_MEMORY_SIZE = 8 * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 8 * 1024 * 1024

# Payment screenshots are served through an owner-checked Django view that
# hands the file to nginx via X-Accel-Redirect. Tests/dev serve directly.
PROTECTED_PROOFS_VIA_NGINX = os.environ.get("PROTECTED_PROOFS_VIA_NGINX", "true").lower() == "true"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ---------------------------------------------------------------- tests
import sys  # noqa: E402

TESTING = len(sys.argv) > 1 and sys.argv[1] == "test"
if TESTING:
    import tempfile

    CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
    PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
    PROTECTED_PROOFS_VIA_NGINX = False
    MEDIA_ROOT = Path(tempfile.mkdtemp(prefix="cf-test-media-"))

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "std": {"format": "%(asctime)s %(levelname)s %(name)s %(message)s"},
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "std"},
    },
    "root": {"handlers": ["console"], "level": "INFO"},
    "loggers": {
        "django.request": {"handlers": ["console"], "level": "WARNING", "propagate": False},
        "crowdfund": {"handlers": ["console"], "level": "INFO", "propagate": False},
    },
}
