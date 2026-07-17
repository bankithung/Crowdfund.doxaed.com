#!/usr/bin/env bash
# Auto-deploy: runs every 2 min via crowdfund-deploy.timer. When origin/main
# has new commits: pull, install deps, migrate, rebuild frontend, collect
# static, restart services. Secrets (.env) and media/ are gitignored and
# survive untouched.
set -euo pipefail

REPO=/home/ubuntu/Crowdfund.doxaed.com
LOCK=/tmp/crowdfund-deploy.lock
TAG=crowdfund-deploy

exec 9>"$LOCK"
flock -n 9 || { logger -t "$TAG" "another deploy is running — skipping"; exit 0; }

cd "$REPO"
git fetch origin main --quiet

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
[ "$LOCAL" = "$REMOTE" ] && exit 0

logger -t "$TAG" "deploying $LOCAL -> $REMOTE"

# server is a deploy target: take origin/main exactly (ignored files survive)
git reset --hard origin/main --quiet

# backend
cd "$REPO/backend"
./venv/bin/pip install -q -r requirements.txt
./venv/bin/python manage.py migrate --noinput | logger -t "$TAG"
./venv/bin/python manage.py collectstatic --noinput >/dev/null

# frontend
cd "$REPO/frontend"
npm install --no-audit --no-fund --silent
npm run build >/dev/null

# services
sudo systemctl restart crowdfund
sudo nginx -t >/dev/null 2>&1 && sudo systemctl reload nginx

# smoke check — roll the alarm if the app died
sleep 2
if curl -sf -o /dev/null http://127.0.0.1/api/public/campaigns/; then
    logger -t "$TAG" "deploy OK at $(git rev-parse --short HEAD)"
else
    logger -t "$TAG" "DEPLOY SMOKE CHECK FAILED at $(git rev-parse --short HEAD)"
    exit 1
fi
