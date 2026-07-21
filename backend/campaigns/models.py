import secrets

from django.conf import settings
from django.db import models
from django.utils.text import slugify

CATEGORY_CHOICES = [
    ("education", "Education"),
    ("medical", "Medical"),
    ("community", "Community"),
    ("emergency", "Emergency"),
    ("creative", "Creative"),
    ("nonprofit", "Non-profit"),
    ("personal", "Personal"),
    ("other", "Other"),
]

# Unambiguous alphabet for donor reference codes (no 0/O, 1/I/L).
REF_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def qr_upload_path(instance, filename):
    return f"qr/{filename}"


def cover_upload_path(instance, filename):
    return f"covers/{filename}"


def proof_upload_path(instance, filename):
    return f"proofs/{filename}"


class Campaign(models.Model):
    STATUS_CHOICES = [
        ("active", "Active"),
        ("paused", "Paused"),
        ("ended", "Ended"),
    ]

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                              related_name="campaigns")
    title = models.CharField(max_length=90)
    slug = models.SlugField(max_length=120, unique=True)
    tagline = models.CharField(max_length=160, blank=True, default="")
    description = models.TextField(max_length=8000)
    category = models.CharField(max_length=20, choices=CATEGORY_CHOICES, default="other")
    goal_amount = models.DecimalField(max_digits=12, decimal_places=2)
    currency = models.CharField(max_length=3, default="INR")
    qr_code = models.ImageField(upload_to=qr_upload_path)
    # Exact string encoded in the uploaded QR (usually a upi:// URI); the
    # mobile "pay" button uses this verbatim so it behaves like a scan.
    qr_payload = models.TextField(blank=True, default="", max_length=1000)
    upi_id = models.CharField(max_length=80, blank=True, default="")
    payee_name = models.CharField(max_length=80, blank=True, default="")
    # Primary QR extras (additional codes live in CampaignQR). Label + an
    # optional daily receiving cap so the organizer can track UPI limits.
    qr_label = models.CharField(max_length=60, blank=True, default="")
    qr_daily_limit = models.DecimalField(max_digits=12, decimal_places=2,
                                         null=True, blank=True)
    cover_image = models.ImageField(upload_to=cover_upload_path, blank=True, null=True)
    end_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="active")
    show_amounts = models.BooleanField(default=True)
    views = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # ------- impact tracking: "12,450 kg secured" alternate progress view
    impact_enabled = models.BooleanField(default=False)
    impact_item = models.CharField(max_length=40, blank=True, default="")    # Cabbage
    impact_unit = models.CharField(max_length=20, blank=True, default="")    # kg
    impact_action = models.CharField(max_length=30, blank=True, default="")  # secured
    impact_target = models.DecimalField(max_digits=14, decimal_places=2,
                                        null=True, blank=True)               # 75,000
    impact_mode = models.CharField(max_length=10, default="auto",
                                   choices=[("auto", "Automatic from verified funds"),
                                            ("manual", "Updated manually")])
    # auto mode: ₹<conv_rupees> provides <conv_units> <unit>
    impact_conv_rupees = models.DecimalField(max_digits=12, decimal_places=2,
                                             null=True, blank=True)
    impact_conv_units = models.DecimalField(max_digits=12, decimal_places=2,
                                            null=True, blank=True)
    impact_funds_basis = models.CharField(
        max_length=10, default="all",
        choices=[("eligible", "Eligible funds after expenses"),
                 ("all", "All verified funds"),
                 ("percent", "Percentage of verified funds")])
    impact_expenses = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    impact_funds_percent = models.PositiveSmallIntegerField(default=100)
    impact_manual_value = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    impact_default_view = models.CharField(max_length=10, default="funds",
                                           choices=[("funds", "Funds"),
                                                    ("impact", "Impact")])
    impact_completed_enabled = models.BooleanField(default=False)
    impact_completed_action = models.CharField(max_length=30, blank=True,
                                               default="")                   # delivered
    impact_completed_qty = models.DecimalField(max_digits=14, decimal_places=2,
                                               default=0)
    impact_updated_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(condition=models.Q(goal_amount__gt=0),
                                   name="campaign_goal_positive"),
        ]

    def __str__(self):
        return self.title

    @staticmethod
    def generate_slug(title):
        base = slugify(title)[:60].strip("-") or "campaign"
        for _ in range(20):
            slug = f"{base}-{secrets.token_hex(2)}"
            if not Campaign.objects.filter(slug=slug).exists():
                return slug
        return f"{base}-{secrets.token_hex(6)}"


class CampaignImage(models.Model):
    """Extra gallery photos — shown with the cover as a public slideshow."""

    campaign = models.ForeignKey(Campaign, on_delete=models.CASCADE,
                                 related_name="images")
    image = models.ImageField(upload_to=cover_upload_path)
    position = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["position", "created_at"]

    def __str__(self):
        return f"image {self.pk} of campaign {self.campaign_id}"


class CampaignQR(models.Model):
    """Additional payment QR codes beyond the campaign's primary one, so an
    organizer can spread receipts across several UPI accounts — each has its
    own daily receiving cap on the bank side."""

    campaign = models.ForeignKey(Campaign, on_delete=models.CASCADE,
                                 related_name="extra_qrs")
    label = models.CharField(max_length=60, blank=True, default="")
    image = models.ImageField(upload_to=qr_upload_path)
    qr_payload = models.TextField(blank=True, default="", max_length=1000)
    upi_id = models.CharField(max_length=80, blank=True, default="")
    payee_name = models.CharField(max_length=80, blank=True, default="")
    daily_limit = models.DecimalField(max_digits=12, decimal_places=2,
                                      null=True, blank=True)
    position = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["position", "id"]

    def __str__(self):
        return f"{self.campaign_id}: {self.label or self.upi_id or self.pk}"


class FundUse(models.Model):
    """'How the money is used' groups — a heading with one or more photos,
    shown on the public page under the story."""

    campaign = models.ForeignKey(Campaign, on_delete=models.CASCADE,
                                 related_name="fund_uses")
    heading = models.CharField(max_length=120)
    position = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["position", "id"]

    def __str__(self):
        return f"{self.campaign_id}: {self.heading}"


class FundUseImage(models.Model):
    fund_use = models.ForeignKey(FundUse, on_delete=models.CASCADE,
                                 related_name="images")
    image = models.ImageField(upload_to=cover_upload_path)
    caption = models.CharField(max_length=160, blank=True, default="")
    position = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["position", "id"]


class Donation(models.Model):
    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("confirmed", "Confirmed"),
        ("rejected", "Rejected"),
    ]

    campaign = models.ForeignKey(Campaign, on_delete=models.CASCADE,
                                 related_name="donations")
    # Which QR the donor paid to (null = the campaign's primary QR), so the
    # organizer can see per-code daily totals against each code's limit.
    qr = models.ForeignKey("CampaignQR", on_delete=models.SET_NULL,
                           null=True, blank=True, related_name="donations")
    public_id = models.CharField(max_length=12, unique=True)
    donor_name = models.CharField(max_length=60)
    donor_email = models.EmailField(blank=True, default="")
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    message = models.CharField(max_length=280, blank=True, default="")
    is_anonymous = models.BooleanField(default=False)
    transaction_ref = models.CharField(max_length=64, blank=True, default="")
    # The donor's own UPI ID or phone number — extra proof the organizer can
    # match against the credit entry in their statement. Never public.
    payer_id = models.CharField(max_length=80, blank=True, default="")
    screenshot = models.ImageField(upload_to=proof_upload_path, blank=True, null=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="pending")
    review_note = models.CharField(max_length=200, blank=True, default="")
    submitted_ip = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["campaign", "status"]),
            models.Index(fields=["campaign", "created_at"]),
        ]
        constraints = [
            models.CheckConstraint(condition=models.Q(amount__gt=0),
                                   name="donation_amount_positive"),
        ]

    def __str__(self):
        return f"{self.donor_name} → {self.campaign_id} ({self.amount})"

    @staticmethod
    def generate_public_id():
        for _ in range(20):
            code = "".join(secrets.choice(REF_ALPHABET) for _ in range(8))
            if not Donation.objects.filter(public_id=code).exists():
                return code
        return "".join(secrets.choice(REF_ALPHABET) for _ in range(12))
