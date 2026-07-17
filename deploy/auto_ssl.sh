#!/usr/bin/env bash
# Runs every 15 min (crowdfund-autossl.timer) until crowdfund.doxaed.com
# points at this server, then obtains a Let's Encrypt cert, flips the app to
# HTTPS mode, and disables itself. Zero-touch SSL once DNS is added.
set -euo pipefail

DOMAIN="crowdfund.doxaed.com"
EXPECTED_IP="98.130.120.70"
ENV_FILE="/home/ubuntu/Crowdfund.doxaed.com/backend/.env"
EMAIL="graceschooledu@gmail.com"
LOG_TAG="crowdfund-autossl"

resolved=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk '{print $1; exit}' || true)
if [ "$resolved" != "$EXPECTED_IP" ]; then
    logger -t "$LOG_TAG" "DNS for $DOMAIN not pointing here yet (got: ${resolved:-none}); waiting."
    exit 0
fi

if [ ! -e "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
    logger -t "$LOG_TAG" "DNS detected — requesting certificate."
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect
fi

if grep -q '^HTTPS_ENABLED=false' "$ENV_FILE"; then
    sed -i 's/^HTTPS_ENABLED=false/HTTPS_ENABLED=true/' "$ENV_FILE"
    systemctl restart crowdfund
    logger -t "$LOG_TAG" "HTTPS enabled; app restarted with secure cookies + HSTS."
fi

nginx -t && systemctl reload nginx
systemctl disable --now crowdfund-autossl.timer
logger -t "$LOG_TAG" "Done — HTTPS live, timer disabled."
