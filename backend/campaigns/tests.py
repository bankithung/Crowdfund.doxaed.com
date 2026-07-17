"""End-to-end API tests: auth, campaign lifecycle, public donate flow,
verification, privacy/permission boundaries."""

import shutil
import tempfile
from decimal import Decimal
from io import BytesIO

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import Client, TestCase, override_settings
from PIL import Image

from .models import Campaign, Donation

TEST_MEDIA = tempfile.mkdtemp(prefix="cf-test-media-")

override = override_settings(
    MEDIA_ROOT=TEST_MEDIA,
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
    PROTECTED_PROOFS_VIA_NGINX=False,
    PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"],  # fast tests
)

User = get_user_model()


def png_upload(name="qr.png", size=(300, 300), color=(20, 20, 20)):
    buf = BytesIO()
    Image.new("RGB", size, color).save(buf, "PNG")
    buf.seek(0)
    buf.name = name
    return buf


def text_upload(name="evil.txt"):
    buf = BytesIO(b"<script>alert(1)</script>")
    buf.name = name
    return buf


@override
class ApiTestCase(TestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(TEST_MEDIA, ignore_errors=True)

    def setUp(self):
        cache.clear()
        self.client = Client()

    # ------------------------------------------------------------ helpers

    def signup(self, email="owner@example.com", name="Asha Rao", password="str0ng-pass-123"):
        return self.client.post("/api/auth/signup/",
                                {"name": name, "email": email, "password": password},
                                content_type="application/json")

    def create_campaign(self, **overrides):
        payload = {
            "title": "Books for Government School",
            "tagline": "Help us stock a library",
            "description": "We are raising funds to buy books for a school library "
                           "serving 400 children in rural Karnataka.",
            "category": "education",
            "goal_amount": "50000",
            "upi_id": "asha@upi",
            "payee_name": "Asha Rao",
            "qr_code": png_upload(),
        }
        payload.update(overrides)
        return self.client.post("/api/campaigns/", payload)

    def donate(self, slug, **overrides):
        payload = {
            "donor_name": "Vikram Iyer",
            "amount": "500",
            "transaction_ref": "UPI123456789",
        }
        payload.update(overrides)
        return self.client.post(f"/api/public/campaigns/{slug}/donate/", payload)

    # --------------------------------------------------------------- auth

    def test_signup_validation_and_duplicate(self):
        bad = self.client.post("/api/auth/signup/",
                               {"name": "A", "email": "not-an-email", "password": "123"},
                               content_type="application/json")
        self.assertEqual(bad.status_code, 400)
        fields = bad.json()["error"]["fields"]
        self.assertIn("name", fields)
        self.assertIn("email", fields)
        self.assertIn("password", fields)

        good = self.signup()
        self.assertEqual(good.status_code, 201)
        self.assertEqual(good.json()["data"]["user"]["email"], "owner@example.com")

        self.client.post("/api/auth/logout/")
        dup = self.signup()
        self.assertEqual(dup.status_code, 400)
        self.assertIn("email", dup.json()["error"]["fields"])

    def test_login_and_me(self):
        self.signup()
        self.client.post("/api/auth/logout/")

        wrong = self.client.post("/api/auth/login/",
                                 {"email": "owner@example.com", "password": "nope"},
                                 content_type="application/json")
        self.assertEqual(wrong.status_code, 400)

        right = self.client.post("/api/auth/login/",
                                 {"email": "OWNER@example.com ", "password": "str0ng-pass-123"},
                                 content_type="application/json")
        self.assertEqual(right.status_code, 200)

        me = self.client.get("/api/auth/me/")
        self.assertEqual(me.json()["data"]["user"]["name"], "Asha Rao")

    def test_csrf_is_enforced(self):
        strict = Client(enforce_csrf_checks=True)
        response = strict.post("/api/auth/signup/",
                               {"name": "X Y", "email": "x@y.com", "password": "str0ng-pass-123"},
                               content_type="application/json")
        self.assertEqual(response.status_code, 403)

    # ---------------------------------------------------------- campaigns

    def test_campaign_requires_auth(self):
        self.assertEqual(self.create_campaign().status_code, 401)

    def test_campaign_create_validates(self):
        self.signup()
        response = self.client.post("/api/campaigns/", {
            "title": "ab", "description": "short", "goal_amount": "5",
        })
        self.assertEqual(response.status_code, 400)
        fields = response.json()["error"]["fields"]
        for key in ("title", "description", "goal_amount", "qr_code"):
            self.assertIn(key, fields)

        bad_file = self.create_campaign(qr_code=text_upload())
        self.assertEqual(bad_file.status_code, 400)
        self.assertIn("qr_code", bad_file.json()["error"]["fields"])

    def test_campaign_create_and_update(self):
        self.signup()
        response = self.create_campaign()
        self.assertEqual(response.status_code, 201)
        data = response.json()["data"]["campaign"]
        self.assertTrue(data["slug"].startswith("books-for-government-school-"))
        self.assertTrue(data["qr_url"].startswith("/media/qr/"))
        self.assertTrue(data["qr_url"].endswith(".png"))

        pk = data["id"]
        update = self.client.post(f"/api/campaigns/{pk}/",
                                  {"title": "Books for Rural Schools", "status": "paused"})
        self.assertEqual(update.status_code, 200)
        updated = update.json()["data"]["campaign"]
        self.assertEqual(updated["title"], "Books for Rural Schools")
        self.assertEqual(updated["status"], "paused")
        # slug unchanged on rename
        self.assertEqual(updated["slug"], data["slug"])

    def test_owner_scoping(self):
        self.signup()
        pk = self.create_campaign().json()["data"]["campaign"]["id"]
        self.client.post("/api/auth/logout/")
        self.signup(email="other@example.com", name="Someone Else")
        self.assertEqual(self.client.get(f"/api/campaigns/{pk}/").status_code, 404)
        self.assertEqual(self.client.post(f"/api/campaigns/{pk}/", {"title": "Hacked title"}).status_code, 404)
        self.assertEqual(self.client.delete(f"/api/campaigns/{pk}/").status_code, 404)

    # ------------------------------------------------------------- public

    def test_public_campaign_and_views_counter(self):
        self.signup()
        slug = self.create_campaign().json()["data"]["campaign"]["slug"]
        anon = Client()
        response = anon.get(f"/api/public/campaigns/{slug}/")
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]["campaign"]
        self.assertTrue(data["is_open"])
        self.assertNotIn("views", data)              # private field
        anon.get(f"/api/public/campaigns/{slug}/")
        self.assertEqual(Campaign.objects.get(slug=slug).views, 2)

        # live-update polls don't inflate the counter
        anon.get(f"/api/public/campaigns/{slug}/?silent=1")
        self.assertEqual(Campaign.objects.get(slug=slug).views, 2)

    def test_donate_flow_and_validation(self):
        self.signup()
        slug = self.create_campaign().json()["data"]["campaign"]["slug"]
        anon = Client()

        missing = anon.post(f"/api/public/campaigns/{slug}/donate/",
                            {"donor_name": "V", "amount": "0"})
        self.assertEqual(missing.status_code, 400)
        fields = missing.json()["error"]["fields"]
        self.assertIn("donor_name", fields)
        self.assertIn("amount", fields)
        self.assertIn("transaction_ref", fields)     # neither ref nor screenshot

        ok_ref = anon.post(f"/api/public/campaigns/{slug}/donate/", {
            "donor_name": "Vikram Iyer", "amount": "999.50",
            "transaction_ref": "TXN-2026-0001",
        })
        self.assertEqual(ok_ref.status_code, 201)
        ref = ok_ref.json()["data"]["donation"]["public_id"]
        self.assertEqual(len(ref), 8)

        ok_shot = anon.post(f"/api/public/campaigns/{slug}/donate/", {
            "donor_name": "Meera K", "amount": "250",
            "screenshot": png_upload("shot.png", size=(800, 1600)),
            "is_anonymous": "true",
        })
        self.assertEqual(ok_shot.status_code, 201)
        self.assertEqual(Donation.objects.count(), 2)
        shot = Donation.objects.get(donor_name="Meera K")
        self.assertTrue(shot.screenshot.name.startswith("proofs/"))

    def test_honeypot_pretends_success(self):
        self.signup()
        slug = self.create_campaign().json()["data"]["campaign"]["slug"]
        response = Client().post(f"/api/public/campaigns/{slug}/donate/", {
            "donor_name": "Bot Bot", "amount": "100",
            "transaction_ref": "BOT1234", "website": "http://spam.example",
        })
        self.assertEqual(response.status_code, 201)
        self.assertEqual(Donation.objects.count(), 0)

    def test_closed_campaigns_reject_donations(self):
        self.signup()
        created = self.create_campaign().json()["data"]["campaign"]
        self.client.post(f"/api/campaigns/{created['id']}/", {"status": "paused"})
        response = self.donate(created["slug"])
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "campaign_closed")

    def test_new_claim_emails_the_organizer(self):
        from django.core import mail

        self.signup()
        slug = self.create_campaign().json()["data"]["campaign"]["slug"]
        Client().post(f"/api/public/campaigns/{slug}/donate/", {
            "donor_name": "Vikram Iyer", "amount": "2000",
            "transaction_ref": "TXN-2026-0042", "payer_id": "vikram@okaxis",
            "message": "All the best", "is_anonymous": "true",
        })

        self.assertEqual(len(mail.outbox), 1)
        sent = mail.outbox[0]
        self.assertEqual(sent.to, ["owner@example.com"])
        self.assertIn("₹2,000", sent.subject)
        self.assertIn("Vikram Iyer", sent.body)
        self.assertIn("TXN-2026-0042", sent.body)
        self.assertIn("vikram@okaxis", sent.body)
        self.assertIn("Anonymous", sent.body)
        self.assertIn("tab=verify", sent.body)

        # honeypot submissions never email anyone
        mail.outbox.clear()
        Client().post(f"/api/public/campaigns/{slug}/donate/", {
            "donor_name": "Bot Bot", "amount": "100",
            "transaction_ref": "BOT1234", "website": "http://spam.example",
        })
        self.assertEqual(len(mail.outbox), 0)

    # ------------------------------------------------- review & donor wall

    def test_review_flow_and_donor_wall(self):
        self.signup()
        created = self.create_campaign().json()["data"]["campaign"]
        slug, pk = created["slug"], created["id"]

        anon = Client()
        anon.post(f"/api/public/campaigns/{slug}/donate/",
                  {"donor_name": "Vikram Iyer", "amount": "500",
                   "transaction_ref": "TXN1", "message": "Good luck!"})
        anon.post(f"/api/public/campaigns/{slug}/donate/",
                  {"donor_name": "Meera K", "amount": "900",
                   "transaction_ref": "TXN2", "is_anonymous": "true"})
        anon.post(f"/api/public/campaigns/{slug}/donate/",
                  {"donor_name": "Spam Guy", "amount": "1", "transaction_ref": "TXN3"})

        # wall is empty before review
        wall = anon.get(f"/api/public/campaigns/{slug}/donors/").json()["data"]
        self.assertEqual(wall["meta"]["total"], 0)

        ids = {d.donor_name: d.pk for d in Donation.objects.all()}
        confirm1 = self.client.post(f"/api/donations/{ids['Vikram Iyer']}/review/",
                                    {"action": "confirm"}, content_type="application/json")
        self.assertEqual(confirm1.status_code, 200)
        self.assertEqual(confirm1.json()["data"]["campaign_stats"]["raised"], 500.0)
        self.client.post(f"/api/donations/{ids['Meera K']}/review/",
                         {"action": "confirm"}, content_type="application/json")
        reject = self.client.post(f"/api/donations/{ids['Spam Guy']}/review/",
                                  {"action": "reject", "note": "No matching credit"},
                                  content_type="application/json")
        self.assertEqual(reject.json()["data"]["donation"]["status"], "rejected")

        wall = anon.get(f"/api/public/campaigns/{slug}/donors/").json()["data"]
        names = [d["name"] for d in wall["donors"]]
        self.assertEqual(wall["meta"]["total"], 2)
        self.assertIn("Vikram Iyer", names)
        self.assertIn("Anonymous", names)
        self.assertNotIn("Meera K", names)
        self.assertNotIn("Spam Guy", names)

        # per-campaign stats reflect confirmations
        detail = self.client.get(f"/api/campaigns/{pk}/").json()["data"]["campaign"]
        self.assertEqual(detail["stats"]["raised"], 1400.0)
        self.assertEqual(detail["stats"]["donors"], 2)
        self.assertEqual(detail["stats"]["pending"], 0)

        # other users cannot review
        other = Client()
        other.post("/api/auth/signup/",
                   {"name": "Other P", "email": "o@example.com", "password": "str0ng-pass-123"},
                   content_type="application/json")
        denied = other.post(f"/api/donations/{ids['Vikram Iyer']}/review/",
                            {"action": "reject"}, content_type="application/json")
        self.assertEqual(denied.status_code, 404)

    def test_owner_edits_claim(self):
        self.signup()
        created = self.create_campaign().json()["data"]["campaign"]
        slug = created["slug"]

        # supporter ticked anonymous by mistake and typo'd their name
        Client().post(f"/api/public/campaigns/{slug}/donate/",
                      {"donor_name": "Bendangchuba Hedmaster", "amount": "200",
                       "transaction_ref": "TXN9", "is_anonymous": "true"})
        donation = Donation.objects.first()
        self.client.post(f"/api/donations/{donation.pk}/review/", {"action": "confirm"},
                         content_type="application/json")

        wall = Client().get(f"/api/public/campaigns/{slug}/donors/").json()["data"]
        self.assertEqual(wall["donors"][0]["name"], "Anonymous")

        edited = self.client.post(
            f"/api/donations/{donation.pk}/edit/",
            {"donor_name": "Bendangchuba Headmaster", "amount": "2000",
             "is_anonymous": "false"},
            content_type="application/json")
        self.assertEqual(edited.status_code, 200)
        data = edited.json()["data"]
        self.assertEqual(data["donation"]["donor_name"], "Bendangchuba Headmaster")
        self.assertFalse(data["donation"]["is_anonymous"])
        self.assertEqual(data["campaign_stats"]["raised"], 2000.0)

        wall = Client().get(f"/api/public/campaigns/{slug}/donors/").json()["data"]
        self.assertEqual(wall["donors"][0]["name"], "Bendangchuba Headmaster")
        self.assertEqual(wall["donors"][0]["amount"], 2000.0)

        # untouched fields survive an edit; status/audit fields can't change
        donation.refresh_from_db()
        self.assertEqual(donation.transaction_ref, "TXN9")
        self.assertEqual(donation.status, "confirmed")

        # every claim detail is editable: ref, payer, email
        full = self.client.post(
            f"/api/donations/{donation.pk}/edit/",
            {"transaction_ref": "TXN9-FIXED", "payer_id": "bendang@okaxis",
             "donor_email": "bendang@example.com"},
            content_type="application/json")
        self.assertEqual(full.status_code, 200)
        donation.refresh_from_db()
        self.assertEqual(donation.transaction_ref, "TXN9-FIXED")
        self.assertEqual(donation.payer_id, "bendang@okaxis")
        self.assertEqual(donation.donor_email, "bendang@example.com")
        bad_payer = self.client.post(f"/api/donations/{donation.pk}/edit/",
                                     {"payer_id": "not a upi"},
                                     content_type="application/json")
        self.assertEqual(bad_payer.status_code, 400)
        self.assertIn("payer_id", bad_payer.json()["error"]["fields"])

        # validation and scoping
        bad = self.client.post(f"/api/donations/{donation.pk}/edit/",
                               {"amount": "0"}, content_type="application/json")
        self.assertEqual(bad.status_code, 400)
        self.assertIn("amount", bad.json()["error"]["fields"])
        empty = self.client.post(f"/api/donations/{donation.pk}/edit/", {},
                                 content_type="application/json")
        self.assertEqual(empty.status_code, 400)

        other = Client()
        other.post("/api/auth/signup/",
                   {"name": "Other P", "email": "o2@example.com", "password": "str0ng-pass-123"},
                   content_type="application/json")
        denied = other.post(f"/api/donations/{donation.pk}/edit/",
                            {"donor_name": "Hijack"}, content_type="application/json")
        self.assertEqual(denied.status_code, 404)

    def test_owner_records_manual_contribution(self):
        self.signup()
        created = self.create_campaign().json()["data"]["campaign"]
        slug, pk = created["slug"], created["id"]

        # someone paid directly but never submitted a claim
        added = self.client.post(
            f"/api/campaigns/{pk}/donations/",
            {"donor_name": "Abeio kire", "amount": "10000",
             "message": "From all of us", "payer_id": "9876543210"},
            content_type="application/json")
        self.assertEqual(added.status_code, 201)
        data = added.json()["data"]
        self.assertEqual(data["donation"]["status"], "confirmed")
        self.assertEqual(data["campaign_stats"]["raised"], 10000.0)

        # on the public wall immediately — no review round-trip needed
        wall = Client().get(f"/api/public/campaigns/{slug}/donors/").json()["data"]
        self.assertEqual(wall["meta"]["total"], 1)
        self.assertEqual(wall["donors"][0]["name"], "Abeio kire")

        # validation still applies; no transaction ref/screenshot required
        bad = self.client.post(f"/api/campaigns/{pk}/donations/",
                               {"donor_name": "X", "amount": "0"},
                               content_type="application/json")
        self.assertEqual(bad.status_code, 400)
        fields = bad.json()["error"]["fields"]
        self.assertIn("donor_name", fields)
        self.assertIn("amount", fields)
        self.assertNotIn("transaction_ref", fields)

        # owner-scoped: outsiders can't inject contributions
        self.assertEqual(Client().post(
            f"/api/campaigns/{pk}/donations/", {"donor_name": "Evil", "amount": "5"},
            content_type="application/json").status_code, 401)

    def test_hidden_amounts_wall(self):
        self.signup()
        created = self.create_campaign(show_amounts="false").json()["data"]["campaign"]
        self.donate(created["slug"])
        donation = Donation.objects.first()
        self.client.post(f"/api/donations/{donation.pk}/review/", {"action": "confirm"},
                         content_type="application/json")
        wall = Client().get(f"/api/public/campaigns/{created['slug']}/donors/").json()["data"]
        self.assertIsNone(wall["donors"][0]["amount"])

    def test_proof_is_private_to_owner(self):
        self.signup()
        slug = self.create_campaign().json()["data"]["campaign"]["slug"]
        Client().post(f"/api/public/campaigns/{slug}/donate/",
                      {"donor_name": "Meera K", "amount": "250",
                       "screenshot": png_upload("shot.png")})
        donation = Donation.objects.first()
        url = f"/api/donations/{donation.pk}/proof/"

        self.assertEqual(Client().get(url).status_code, 401)          # anonymous

        other = Client()
        other.post("/api/auth/signup/",
                   {"name": "Other P", "email": "o2@example.com", "password": "str0ng-pass-123"},
                   content_type="application/json")
        self.assertEqual(other.get(url).status_code, 404)             # not owner

        owner_response = self.client.get(url)
        self.assertEqual(owner_response.status_code, 200)
        self.assertIn(owner_response["Content-Type"], ("image/jpeg", "image/png"))

    def test_status_check(self):
        self.signup()
        slug = self.create_campaign().json()["data"]["campaign"]["slug"]
        ref = self.donate(slug).json()["data"]["donation"]["public_id"]
        response = Client().get(f"/api/public/donations/{ref.lower()}/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["donation"]["status"], "pending")

    # ---------------------------------------------------- analytics & CSV

    def test_receipt_and_lookup(self):
        self.signup()
        slug = self.create_campaign().json()["data"]["campaign"]["slug"]
        anon = Client()
        ref = anon.post(f"/api/public/campaigns/{slug}/donate/", {
            "donor_name": "Vikram Iyer", "amount": "999.50",
            "transaction_ref": "TXN-2026-0001", "payer_id": "vikram@okaxis",
        }).json()["data"]["donation"]["public_id"]

        # no receipt before verification
        self.assertEqual(anon.get(f"/api/public/donations/{ref}/receipt/").status_code, 404)

        donation = Donation.objects.get(public_id=ref)
        self.client.post(f"/api/donations/{donation.pk}/review/", {"action": "confirm"},
                         content_type="application/json")

        receipt = anon.get(f"/api/public/donations/{ref}/receipt/")
        self.assertEqual(receipt.status_code, 200)
        page = receipt.content.decode()
        for text in ("Vikram Iyer", "₹999.5", "TXN-2026-0001", ref,
                     "Verified by the organizer"):
            self.assertIn(text, page)

        # real PDF download too — print() is unreliable on phones
        pdf = anon.get(f"/api/public/donations/{ref}/receipt.pdf")
        self.assertEqual(pdf.status_code, 200)
        self.assertEqual(pdf["Content-Type"], "application/pdf")
        self.assertIn("attachment", pdf["Content-Disposition"])
        self.assertTrue(pdf.content.startswith(b"%PDF"))
        self.assertEqual(
            anon.get("/api/public/donations/NOPE1234/receipt.pdf").status_code, 404)

        # lookup works by ref code, transaction ID, and payer UPI/phone
        for q in (ref, "txn-2026-0001", "VIKRAM@OKAXIS"):
            found = anon.get(f"/api/public/donations/lookup/?q={q}").json()["data"]
            self.assertEqual(len(found["donations"]), 1, q)
            self.assertEqual(found["donations"][0]["public_id"], ref)
        none = anon.get("/api/public/donations/lookup/?q=NOPE9999").json()["data"]
        self.assertEqual(none["donations"], [])
        short = anon.get("/api/public/donations/lookup/?q=ab")
        self.assertEqual(short.status_code, 400)

    def test_analytics_and_export_and_dashboard(self):
        self.signup()
        created = self.create_campaign().json()["data"]["campaign"]
        slug, pk = created["slug"], created["id"]
        self.donate(slug)
        donation = Donation.objects.first()
        self.client.post(f"/api/donations/{donation.pk}/review/", {"action": "confirm"},
                         content_type="application/json")

        analytics = self.client.get(f"/api/campaigns/{pk}/analytics/")
        self.assertEqual(analytics.status_code, 200)
        payload = analytics.json()["data"]["analytics"]
        self.assertEqual(payload["raised"], 500.0)
        self.assertEqual(len(payload["series"]), 30)
        self.assertEqual(payload["series"][-1]["amount"], 500.0)

        export = self.client.get(f"/api/campaigns/{pk}/export/")
        self.assertEqual(export.status_code, 200)
        self.assertIn("text/csv", export["Content-Type"])
        body = export.content.decode("utf-8")
        self.assertIn("Vikram Iyer", body)
        self.assertIn("UPI123456789", body)

        dashboard = self.client.get("/api/dashboard/")
        totals = dashboard.json()["data"]["totals"]
        self.assertEqual(totals["raised"], 500.0)
        self.assertEqual(totals["campaigns"], 1)

        # export/analytics blocked for strangers
        other = Client()
        other.post("/api/auth/signup/",
                   {"name": "Other P", "email": "o3@example.com", "password": "str0ng-pass-123"},
                   content_type="application/json")
        self.assertEqual(other.get(f"/api/campaigns/{pk}/analytics/").status_code, 404)
        self.assertEqual(other.get(f"/api/campaigns/{pk}/export/").status_code, 404)

    def test_delete_campaign_removes_donations(self):
        self.signup()
        created = self.create_campaign().json()["data"]["campaign"]
        self.donate(created["slug"])
        self.assertEqual(self.client.delete(f"/api/campaigns/{created['id']}/").status_code, 200)
        self.assertEqual(Campaign.objects.count(), 0)
        self.assertEqual(Donation.objects.count(), 0)

    # ------------------------------------------------------ claim flow v2

    def test_payer_id_validation_and_storage(self):
        self.signup()
        slug = self.create_campaign().json()["data"]["campaign"]["slug"]

        bad = self.donate(slug, payer_id="not-a-upi-or-phone")
        self.assertEqual(bad.status_code, 400)
        self.assertIn("payer_id", bad.json()["error"]["fields"])

        ok_upi = self.donate(slug, payer_id="donor@okbank")
        self.assertEqual(ok_upi.status_code, 201)
        ok_phone = self.donate(slug, donor_name="Phone Donor",
                               transaction_ref="TXN22222", payer_id="9876543210")
        self.assertEqual(ok_phone.status_code, 201)

        stored = {d.donor_name: d.payer_id for d in Donation.objects.all()}
        self.assertEqual(stored["Vikram Iyer"], "donor@okbank")
        self.assertEqual(stored["Phone Donor"], "9876543210")

        # payer id shows to the organizer, never publicly
        pk = Donation.objects.get(donor_name="Phone Donor").pk
        self.client.post(f"/api/donations/{pk}/review/", {"action": "confirm"},
                         content_type="application/json")
        wall = Client().get(f"/api/public/campaigns/{slug}/donors/").content.decode()
        self.assertNotIn("9876543210", wall)

    def test_parse_screenshot_endpoint(self):
        from PIL import ImageDraw, ImageFont
        img = Image.new("RGB", (760, 320), "white")
        draw = ImageDraw.Draw(img)
        font = ImageFont.truetype(
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 30)
        draw.text((30, 20), "Payment successful", font=font, fill="black")
        draw.text((30, 80), "Rs 750.50", font=font, fill="black")
        draw.text((30, 140), "UPI transaction ID: 415011223344", font=font, fill="black")
        draw.text((30, 200), "From: donorperson@ybl", font=font, fill="black")
        draw.text((30, 255), "Paid by Ravi Kumar", font=font, fill="black")
        buf = BytesIO()
        img.save(buf, "PNG")
        buf.seek(0)
        buf.name = "receipt.png"

        response = self.client.post("/api/public/parse-screenshot/", {"screenshot": buf})
        self.assertEqual(response.status_code, 200, response.content)
        detected = response.json()["data"]["detected"]
        self.assertEqual(detected["transaction_ref"], "415011223344")
        self.assertEqual(detected["amount"], "750.50")
        self.assertEqual(detected["payer_id"], "donorperson@ybl")
        self.assertEqual(detected["payer_name"], "Ravi Kumar")

    def test_gallery_add_delete_and_public_payload(self):
        self.signup()
        created = self.create_campaign().json()["data"]["campaign"]
        pk, slug = created["id"], created["slug"]

        response = self.client.post(f"/api/campaigns/{pk}/images/",
                                    {"image": png_upload("g1.png")})
        self.assertEqual(response.status_code, 201, response.content)
        response = self.client.post(f"/api/campaigns/{pk}/images/",
                                    {"image": png_upload("g2.png")})
        gallery = response.json()["data"]["campaign"]["gallery"]
        self.assertEqual(len(gallery), 2)          # no cover on this campaign
        self.assertTrue(all(g["url"].startswith("/media/covers/") for g in gallery))

        public = Client().get(f"/api/public/campaigns/{slug}/").json()["data"]["campaign"]
        self.assertEqual(len(public["gallery"]), 2)

        # strangers cannot manage the gallery
        other = Client()
        other.post("/api/auth/signup/",
                   {"name": "Other P", "email": "gal@example.com",
                    "password": "str0ng-pass-123"},
                   content_type="application/json")
        denied = other.post(f"/api/campaigns/{pk}/images/", {"image": png_upload()})
        self.assertEqual(denied.status_code, 404)

        image_id = gallery[0]["id"]
        deleted = self.client.delete(f"/api/campaigns/{pk}/images/{image_id}/")
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(len(deleted.json()["data"]["campaign"]["gallery"]), 1)

    def test_organizer_verified_badge_flag(self):
        self.signup()
        slug = self.create_campaign().json()["data"]["campaign"]["slug"]
        data = Client().get(f"/api/public/campaigns/{slug}/").json()["data"]["campaign"]
        self.assertFalse(data["organizer_verified"])
        User.objects.filter(email="owner@example.com").update(is_verified=True)
        data = Client().get(f"/api/public/campaigns/{slug}/").json()["data"]["campaign"]
        self.assertTrue(data["organizer_verified"])
