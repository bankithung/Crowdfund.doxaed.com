#!/usr/bin/env bash
# Auto-deploy: runs every 2 min via crowdfund-deploy.timer. When origin/main
# is strictly ahead of the local checkout: pull, install deps, migrate,
# rebuild frontend, collect static, restart services. Secrets (.env) and
# media/ are gitignored and survive untouched.
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

# Deploy ONLY fast-forwards: if local is ahead or diverged (work happening
# on the server), leave it alone rather than destroying commits.
if ! git merge-base --is-ancestor "$LOCAL" "$REMOTE"; then
    logger -t "$TAG" "local is ahead/diverged of origin/main — not deploying"
    exit 0
fi

logger -t "$TAG" "deploying ${LOCAL:0:7} -> ${REMOTE:0:7}"

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

# smoke check
sleep 2
if curl -sf -o /dev/null http://127.0.0.1/api/public/campaigns/; then
    logger -t "$TAG" "deploy OK at $(git rev-parse --short HEAD)"
else
    logger -t "$TAG" "DEPLOY SMOKE CHECK FAILED at $(git rev-parse --short HEAD)"
    exit 1
fi
