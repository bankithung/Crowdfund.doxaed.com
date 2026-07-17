# CrowdFund — crowdfund.doxaed.com

Direct, verified community fundraising. Organizers upload their own UPI QR;
supporters pay them directly and submit proof; organizers verify each claim
by hand before it appears on the public supporter wall. 0% fees, zero custody.

## Stack

- **Backend**: Django 6 · PostgreSQL · gunicorn (systemd: `crowdfund.service`)
- **Frontend**: React 19 + Vite (built to `frontend/dist`, served by nginx)
- **OCR**: tesseract (payment-screenshot autofill)
- **Server**: nginx + Let's Encrypt on Ubuntu

## Layout

```
backend/    Django project (venv lives here, not committed)
frontend/   Vite + React app
deploy/     nginx/systemd configs + auto-deploy script
media/      user uploads (not committed)
```

## Auto-deploy

`deploy/auto_deploy.sh` runs via `crowdfund-deploy.timer` every 2 minutes on
the production server: it fetches `origin/main`, and when new commits land it
pulls, installs backend/frontend deps, runs migrations, rebuilds the frontend,
collects static files and restarts services. Push to `main` and the site
updates itself within ~2 minutes.

Secrets (`backend/.env`, admin credentials) and user uploads never leave the
server — they are gitignored.
