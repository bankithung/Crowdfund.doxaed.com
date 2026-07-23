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

    def test_password_reset_flow(self):
        from django.contrib.auth.tokens import default_token_generator
        from django.core import mail
        from django.utils.encoding import force_bytes
        from django.utils.http import urlsafe_base64_encode

        from accounts.models import User

        self.signup()
        self.client.post("/api/auth/logout/")
        anon = Client()

        # unknown email still reports success (no user enumeration), no mail
        mail.outbox.clear()
        blank = anon.post("/api/auth/password/reset/",
                          {"email": "nobody@example.com"}, content_type="application/json")
        self.assertEqual(blank.status_code, 200)
        self.assertEqual(len(mail.outbox), 0)

        # real email → a reset mail is sent
        req = anon.post("/api/auth/password/reset/",
                        {"email": "owner@example.com"}, content_type="application/json")
        self.assertEqual(req.status_code, 200)
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("reset", mail.outbox[0].subject.lower())

        user = User.objects.get(email="owner@example.com")
        uid = urlsafe_base64_encode(force_bytes(user.pk))
        token = default_token_generator.make_token(user)

        # a bad token is rejected
        bad = anon.post("/api/auth/password/reset/confirm/",
                        {"uid": uid, "token": "bogus-token", "new_password": "Fresh-pass-99"},
                        content_type="application/json")
        self.assertEqual(bad.status_code, 400)

        # weak password is rejected even with a valid token
        weak = anon.post("/api/auth/password/reset/confirm/",
                         {"uid": uid, "token": token, "new_password": "123"},
                         content_type="application/json")
        self.assertEqual(weak.status_code, 400)
        self.assertIn("new_password", weak.json()["error"]["fields"])

        # valid reset works, and the new password logs in
        good = anon.post("/api/auth/password/reset/confirm/",
                         {"uid": uid, "token": token, "new_password": "Fresh-pass-99"},
                         content_type="application/json")
        self.assertEqual(good.status_code, 200)
        login = anon.post("/api/auth/login/",
                          {"email": "owner@example.com", "password": "Fresh-pass-99"},
                          content_type="application/json")
        self.assertEqual(login.status_code, 200)

        # the token is single-use — password changed, so it no longer validates
        reuse = anon.post("/api/auth/password/reset/confirm/",
                          {"uid": uid, "token": token, "new_password": "Another-pass-11"},
                          content_type="application/json")
        self.assertEqual(reuse.status_code, 400)

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

    def test_ocr_amount_rupee_misread(self):
        from campaigns.ocr import _pick_amount

        # Google Pay screenshot: the big ₹500 loses its marker ("%500"),
        # while '₹' in the detail rows merges into the digits → "2500".
        text = ("Received from Ketou T\n18 Jul, 5:31pm\n%500\n"
                "Transaction details\nPayment method UPI\n"
                "UPI Transaction ID 619995438375\n"
                "Google Transaction ID CICAgLjEoO2nFQ\n"
                "Paid via Google Pay\nCustomer paid 2500\nAmount you get 2500\n")
        self.assertEqual(_pick_amount(text, "619995438375"), "500")

        # a genuine ₹2,500 payment is untouched
        clean = "Customer paid ₹2,500\nAmount you get ₹2,500"
        self.assertEqual(_pick_amount(clean, ""), "2500")

        # decimals: ₹500.00 misread alongside a clean 500.00
        decimals = "Amount paid 2500.00\nTotal ₹500.00"
        self.assertEqual(_pick_amount(decimals, ""), "500.00")

    def test_multiple_qrs_and_daily_limits(self):
        self.signup()
        created = self.create_campaign().json()["data"]["campaign"]
        slug, pk = created["slug"], created["id"]

        # one QR by default (the primary), id 0
        self.assertEqual(len(created["qrs"]), 1)
        self.assertEqual(created["qrs"][0]["id"], 0)

        # set a daily limit on the primary, add a second QR with its own limit
        self.client.post(f"/api/campaigns/{pk}/",
                         {"qr_label": "SBI account", "qr_daily_limit": "100000"})
        added = self.client.post(f"/api/campaigns/{pk}/qrs/", {
            "label": "Axis account", "upi_id": "grace@okaxis",
            "daily_limit": "50000", "image": png_upload("qr2.png")})
        self.assertEqual(added.status_code, 201)
        qrs = added.json()["data"]["campaign"]["qrs"]
        self.assertEqual(len(qrs), 2)
        extra_id = qrs[1]["id"]
        self.assertEqual(qrs[0]["label"], "SBI account")
        self.assertEqual(qrs[0]["daily_limit"], 100000.0)
        self.assertEqual(qrs[1]["daily_limit"], 50000.0)

        # public page shows both QRs
        public = Client().get(f"/api/public/campaigns/{slug}/").json()["data"]["campaign"]
        self.assertEqual(len(public["qrs"]), 2)

        # a supporter pays to the extra QR; confirm it
        anon = Client()
        anon.post(f"/api/public/campaigns/{slug}/donate/",
                  {"donor_name": "Vikram Iyer", "amount": "40000",
                   "transaction_ref": "TXNQR1", "qr": str(extra_id)})
        d = Donation.objects.get(transaction_ref="TXNQR1")
        self.assertEqual(d.qr_id, extra_id)
        self.client.post(f"/api/donations/{d.pk}/review/", {"action": "confirm"},
                         content_type="application/json")

        # received-today rolls up under that QR; it's now near its cap
        qrs = self.client.get(f"/api/campaigns/{pk}/").json()["data"]["campaign"]["qrs"]
        extra = next(q for q in qrs if q["id"] == extra_id)
        self.assertEqual(extra["received_today"], 40000.0)
        self.assertEqual(extra["remaining_today"], 10000.0)
        self.assertFalse(extra["is_full"])
        self.assertEqual(qrs[0]["received_today"], 0.0)   # primary untouched

        # a second payment tips it over the limit → is_full
        anon.post(f"/api/public/campaigns/{slug}/donate/",
                  {"donor_name": "Meera K", "amount": "15000",
                   "transaction_ref": "TXNQR2", "qr": str(extra_id)})
        d2 = Donation.objects.get(transaction_ref="TXNQR2")
        self.client.post(f"/api/donations/{d2.pk}/review/", {"action": "confirm"},
                         content_type="application/json")
        extra = next(q for q in self.client.get(f"/api/campaigns/{pk}/")
                     .json()["data"]["campaign"]["qrs"] if q["id"] == extra_id)
        self.assertTrue(extra["is_full"])

        # editing a claim can move it to another QR
        self.client.post(f"/api/donations/{d2.pk}/edit/", {"qr": "0"})
        self.assertIsNone(Donation.objects.get(pk=d2.pk).qr_id)

        # hidden amounts: public payload drops the numbers but keeps is_full
        self.client.post(f"/api/campaigns/{pk}/", {"show_amounts": "false"})
        pub_qr = Client().get(f"/api/public/campaigns/{slug}/").json()["data"]["campaign"]["qrs"]
        self.assertNotIn("received_today", pub_qr[1])
        self.assertIn("is_full", pub_qr[1])

        # delete the extra QR; its donations fall back to the primary
        gone = self.client.delete(f"/api/campaigns/{pk}/qrs/{extra_id}/")
        self.assertEqual(gone.status_code, 200)
        self.assertEqual(len(gone.json()["data"]["campaign"]["qrs"]), 1)
        self.assertIsNone(Donation.objects.get(pk=d.pk).qr_id)

        # bad limit is rejected
        bad = self.client.post(f"/api/campaigns/{pk}/qrs/",
                               {"daily_limit": "-5", "image": png_upload("q.png")})
        self.assertEqual(bad.status_code, 400)
        self.assertIn("daily_limit", bad.json()["error"]["fields"])

    def test_fund_uses(self):
        self.signup()
        created = self.create_campaign().json()["data"]["campaign"]
        slug, pk = created["slug"], created["id"]
        self.assertEqual(created["fund_uses"], [])

        # create a group with two photos at once
        added = self.client.post(f"/api/campaigns/{pk}/fund-uses/",
                                 {"heading": "Purchasing cabbage from farmers",
                                  "images": [png_upload("use1.png"), png_upload("use2.png")]})
        self.assertEqual(added.status_code, 201)
        self.client.post(f"/api/campaigns/{pk}/fund-uses/",
                         {"heading": "Transport to distribution points",
                          "images": [png_upload("use3.png")]})

        # public page shows the groups in order, each with its images
        public = Client().get(f"/api/public/campaigns/{slug}/").json()["data"]["campaign"]
        headings = [use["heading"] for use in public["fund_uses"]]
        self.assertEqual(headings, ["Purchasing cabbage from farmers",
                                    "Transport to distribution points"])
        self.assertEqual(len(public["fund_uses"][0]["images"]), 2)
        self.assertTrue(all(img["url"] for use in public["fund_uses"]
                            for img in use["images"]))

        # edit the heading; append another photo to the same group
        use_id = public["fund_uses"][0]["id"]
        edited = self.client.post(
            f"/api/campaigns/{pk}/fund-uses/{use_id}/",
            {"heading": "Buying cabbage directly from farmers",
             "images": [png_upload("use4.png")]})
        self.assertEqual(edited.status_code, 200)
        group = edited.json()["data"]["campaign"]["fund_uses"][0]
        self.assertEqual(group["heading"], "Buying cabbage directly from farmers")
        self.assertEqual(len(group["images"]), 3)

        # remove one photo from the group
        img_id = group["images"][0]["id"]
        trimmed = self.client.delete(
            f"/api/campaigns/{pk}/fund-uses/{use_id}/images/{img_id}/")
        self.assertEqual(trimmed.status_code, 200)
        self.assertEqual(
            len(trimmed.json()["data"]["campaign"]["fund_uses"][0]["images"]), 2)

        # caption a photo — the public payload carries it
        img_id2 = trimmed.json()["data"]["campaign"]["fund_uses"][0]["images"][0]["id"]
        capped = self.client.post(
            f"/api/campaigns/{pk}/fund-uses/{use_id}/images/{img_id2}/",
            {"caption": "Loading at the Razeba collection point"})
        self.assertEqual(capped.status_code, 200)
        public2 = Client().get(f"/api/public/campaigns/{slug}/").json()["data"]["campaign"]
        self.assertEqual(public2["fund_uses"][0]["images"][0]["caption"],
                         "Loading at the Razeba collection point")
        too_long = self.client.post(
            f"/api/campaigns/{pk}/fund-uses/{use_id}/images/{img_id2}/",
            {"caption": "x" * 200})
        self.assertEqual(too_long.status_code, 400)

        # validation: heading and at least one image required on create
        bad = self.client.post(f"/api/campaigns/{pk}/fund-uses/", {"heading": "x"})
        self.assertEqual(bad.status_code, 400)
        fields = bad.json()["error"]["fields"]
        self.assertIn("heading", fields)
        self.assertIn("image", fields)

        # other owners can't touch it; owner can delete the whole group
        other = Client()
        other.post("/api/auth/signup/",
                   {"name": "Other P", "email": "fu@example.com", "password": "str0ng-pass-123"},
                   content_type="application/json")
        self.assertEqual(
            other.delete(f"/api/campaigns/{pk}/fund-uses/{use_id}/").status_code, 404)
        gone = self.client.delete(f"/api/campaigns/{pk}/fund-uses/{use_id}/")
        self.assertEqual(gone.status_code, 200)
        self.assertEqual(len(gone.json()["data"]["campaign"]["fund_uses"]), 1)

    def test_impact_tracking(self):
        self.signup()
        created = self.create_campaign().json()["data"]["campaign"]
        slug, pk = created["slug"], created["id"]
        self.assertIsNone(created["impact"])            # off by default

        # ₹2,600 verified (2,000 + 600)
        anon = Client()
        for name, amount, ref in (("A", "2000", "TXN1"), ("B", "600", "TXN2")):
            anon.post(f"/api/public/campaigns/{slug}/donate/",
                      {"donor_name": name * 3, "amount": amount, "transaction_ref": ref})
        for donation in Donation.objects.all():
            self.client.post(f"/api/donations/{donation.pk}/review/",
                             {"action": "confirm"}, content_type="application/json")

        # enable: ₹13 → 1 kg of cabbage, target 75,000 kg, completed 200 kg
        update = self.client.post(f"/api/campaigns/{pk}/", {
            "impact_enabled": "true", "impact_item": "Cabbage", "impact_unit": "kg",
            "impact_action": "secured", "impact_target": "75000",
            "impact_mode": "auto", "impact_conv_rupees": "13", "impact_conv_units": "1",
            "impact_funds_basis": "all", "impact_default_view": "impact",
            "impact_completed_enabled": "true", "impact_completed_action": "delivered",
            "impact_completed_qty": "200",
        })
        self.assertEqual(update.status_code, 200)
        impact = update.json()["data"]["campaign"]["impact"]
        self.assertEqual(impact["secured"], 200)         # 2600 / 13
        self.assertEqual(impact["target"], 75000.0)
        self.assertEqual(impact["progress"], 0.3)
        self.assertEqual(impact["default_view"], "impact")
        self.assertEqual(impact["completed"], {"action": "delivered", "qty": 200.0})
        self.assertIsNotNone(impact["updated_at"])
        settings_blob = update.json()["data"]["campaign"]["impact_settings"]
        self.assertEqual(settings_blob["impact_conv_rupees"], 13.0)

        # public payload carries impact, but never the raw settings
        public = anon.get(f"/api/public/campaigns/{slug}/").json()["data"]["campaign"]
        self.assertEqual(public["impact"]["secured"], 200)
        self.assertNotIn("impact_settings", public)

        # percentage basis: 50% of ₹2,600 → 100 kg
        self.client.post(f"/api/campaigns/{pk}/", {
            "impact_funds_basis": "percent", "impact_funds_percent": "50"})
        impact = self.client.get(f"/api/campaigns/{pk}/").json()["data"]["campaign"]["impact"]
        self.assertEqual(impact["secured"], 100)

        # eligible-after-expenses: (2600 - 600) / 13 ≈ 153.8 kg
        self.client.post(f"/api/campaigns/{pk}/", {
            "impact_funds_basis": "eligible", "impact_expenses": "600"})
        impact = self.client.get(f"/api/campaigns/{pk}/").json()["data"]["campaign"]["impact"]
        self.assertEqual(impact["secured"], 153.8)

        # manual mode ignores conversion entirely
        self.client.post(f"/api/campaigns/{pk}/", {
            "impact_mode": "manual", "impact_manual_value": "12450"})
        impact = self.client.get(f"/api/campaigns/{pk}/").json()["data"]["campaign"]["impact"]
        self.assertEqual(impact["secured"], 12450)
        self.assertEqual(impact["progress"], 16.6)

        # validation
        bad = self.client.post(f"/api/campaigns/{pk}/", {"impact_funds_percent": "150"})
        self.assertEqual(bad.status_code, 400)
        self.assertIn("impact_funds_percent", bad.json()["error"]["fields"])

        # the settings form submits EVERY field — empty optionals must never 400
        form_like = {
            "impact_enabled": "false", "impact_item": "", "impact_unit": "",
            "impact_action": "", "impact_target": "", "impact_mode": "auto",
            "impact_conv_rupees": "", "impact_conv_units": "1",
            "impact_funds_basis": "all", "impact_expenses": "",
            "impact_funds_percent": "100", "impact_manual_value": "",
            "impact_default_view": "funds", "impact_completed_enabled": "false",
            "impact_completed_action": "", "impact_completed_qty": "",
        }
        off = self.client.post(f"/api/campaigns/{pk}/", form_like)
        self.assertEqual(off.status_code, 200)
        self.assertIsNone(off.json()["data"]["campaign"]["impact"])

        # ...but enabling does require a target and a conversion
        missing = self.client.post(f"/api/campaigns/{pk}/",
                                   {**form_like, "impact_enabled": "true"})
        self.assertEqual(missing.status_code, 400)
        fields = missing.json()["error"]["fields"]
        self.assertIn("impact_target", fields)
        self.assertIn("impact_conv_rupees", fields)

    def test_duplicate_transaction_ref_flagged(self):
        from django.core import mail

        self.signup()
        created = self.create_campaign().json()["data"]["campaign"]
        slug, pk = created["slug"], created["id"]
        anon = Client()
        anon.post(f"/api/public/campaigns/{slug}/donate/",
                  {"donor_name": "Cornerstone", "amount": "1000",
                   "transaction_ref": "126417103717"})
        mail.outbox.clear()
        anon.post(f"/api/public/campaigns/{slug}/donate/",
                  {"donor_name": "Tokavi", "amount": "1000",
                   "transaction_ref": "126417103717"})
        anon.post(f"/api/public/campaigns/{slug}/donate/",
                  {"donor_name": "Unique Guy", "amount": "500",
                   "transaction_ref": "999888777"})

        listing = self.client.get(f"/api/campaigns/{pk}/donations/").json()["data"]
        flags = {d["donor_name"]: d["duplicate_ref"] for d in listing["donations"]}
        self.assertTrue(flags["Cornerstone"])
        self.assertTrue(flags["Tokavi"])
        self.assertFalse(flags["Unique Guy"])

        # the alert email for the second claim warns the organizer
        self.assertIn("ALREADY ON ANOTHER CLAIM", mail.outbox[0].body)

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

        # a screenshot can be added after the fact… (claim had none)
        self.assertFalse(donation.screenshot)
        shot = self.client.post(f"/api/donations/{donation.pk}/edit/",
                                {"screenshot": png_upload("late-proof.png")})
        self.assertEqual(shot.status_code, 200)
        self.assertTrue(shot.json()["data"]["donation"]["has_screenshot"])
        donation.refresh_from_db()
        first_name = donation.screenshot.name
        self.assertTrue(first_name.startswith("proofs/"))

        # …and replaced later — the old file gives way to the new one
        replaced = self.client.post(f"/api/donations/{donation.pk}/edit/",
                                    {"screenshot": png_upload("better-proof.png")})
        self.assertEqual(replaced.status_code, 200)
        donation.refresh_from_db()
        self.assertTrue(donation.screenshot.name)
        self.assertNotEqual(donation.screenshot.name, first_name)

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

        # multipart with a screenshot works too — stored as proof
        with_shot = self.client.post(
            f"/api/campaigns/{pk}/donations/",
            {"donor_name": "Manual With Proof", "amount": "750",
             "screenshot": png_upload("manual-proof.png")})
        self.assertEqual(with_shot.status_code, 201)
        self.assertTrue(with_shot.json()["data"]["donation"]["has_screenshot"])
        proof = Donation.objects.get(donor_name="Manual With Proof")
        self.assertTrue(proof.screenshot.name.startswith("proofs/"))

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
