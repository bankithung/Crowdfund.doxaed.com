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

## Email alerts (Amazon SES)

Organizers get an email the moment a payment claim is submitted. Mail is sent
through Amazon SES's SMTP interface — add to `backend/.env` on the server:

```
EMAIL_HOST=email-smtp.ap-south-1.amazonaws.com
EMAIL_HOST_USER=<SES SMTP username>
EMAIL_HOST_PASSWORD=<SES SMTP password>
DEFAULT_FROM_EMAIL=CrowdFund <no-reply@doxaed.com>
```

The From address (or its domain) must be verified in SES, and the SES account
moved out of sandbox mode to mail arbitrary organizer addresses. Without
`EMAIL_HOST` configured, mail is logged to the console instead of sent.

Secrets (`backend/.env`, admin credentials) and user uploads never leave the
server — they are gitignored.
