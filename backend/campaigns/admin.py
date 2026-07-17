from django.contrib import admin

from .models import Campaign, Donation


@admin.register(Campaign)
class CampaignAdmin(admin.ModelAdmin):
    list_display = ("title", "owner", "status", "goal_amount", "views", "created_at")
    list_filter = ("status", "category")
    search_fields = ("title", "slug", "owner__email")
    readonly_fields = ("slug", "views", "created_at", "updated_at")
    raw_id_fields = ("owner",)


@admin.register(Donation)
class DonationAdmin(admin.ModelAdmin):
    list_display = ("public_id", "donor_name", "amount", "status", "campaign",
                    "created_at")
    list_filter = ("status",)
    search_fields = ("public_id", "donor_name", "donor_email", "transaction_ref",
                     "campaign__title")
    readonly_fields = ("public_id", "created_at", "submitted_ip")
    raw_id_fields = ("campaign",)
