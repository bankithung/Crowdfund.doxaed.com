from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    ordering = ("-date_joined",)
    list_display = ("email", "name", "is_verified", "is_active", "is_staff", "date_joined")
    list_filter = ("is_verified", "is_active", "is_staff")
    list_editable = ("is_verified",)
    search_fields = ("email", "name")
    fieldsets = (
        (None, {"fields": ("email", "name", "password")}),
        ("Trust", {"fields": ("is_verified",),
                   "description": "Verified organizers get a public 'Verified organizer' "
                                  "badge on all their fundraiser pages."}),
        ("Status", {"fields": ("is_active", "is_staff", "is_superuser")}),
        ("Dates", {"fields": ("last_login", "date_joined")}),
    )
    add_fieldsets = (
        (None, {"classes": ("wide",),
                "fields": ("email", "name", "password1", "password2")}),
    )
    readonly_fields = ("last_login", "date_joined")
    filter_horizontal = ()
