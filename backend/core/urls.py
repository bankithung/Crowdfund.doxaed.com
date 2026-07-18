from django.contrib import admin
from django.urls import path

from accounts import views as auth_views
from campaigns import public_views as public
from campaigns import views as camp

urlpatterns = [
    path("django-admin/", admin.site.urls),

    # Auth
    path("api/auth/csrf/", auth_views.csrf_view),
    path("api/auth/signup/", auth_views.signup_view),
    path("api/auth/login/", auth_views.login_view),
    path("api/auth/logout/", auth_views.logout_view),
    path("api/auth/me/", auth_views.me_view),
    path("api/auth/password/", auth_views.change_password_view),

    # Organizer
    path("api/dashboard/", camp.dashboard_view),
    path("api/campaigns/", camp.campaigns_view),
    path("api/campaigns/<int:pk>/", camp.campaign_detail_view),
    path("api/campaigns/<int:pk>/images/", camp.campaign_images_view),
    path("api/campaigns/<int:pk>/images/<int:image_id>/", camp.campaign_image_delete_view),
    path("api/campaigns/<int:pk>/fund-uses/", camp.fund_use_add_view),
    path("api/campaigns/<int:pk>/fund-uses/<int:item_id>/", camp.fund_use_delete_view),
    path("api/campaigns/<int:pk>/donations/", camp.campaign_donations_view),
    path("api/campaigns/<int:pk>/analytics/", camp.campaign_analytics_view),
    path("api/campaigns/<int:pk>/export/", camp.campaign_export_view),
    path("api/donations/<int:pk>/review/", camp.donation_review_view),
    path("api/donations/<int:pk>/edit/", camp.donation_edit_view),
    path("api/donations/<int:pk>/proof/", camp.donation_proof_view),

    # Public
    path("api/public/campaigns/", public.public_campaigns_index),
    path("api/public/campaigns/<slug:slug>/", public.public_campaign_view),
    path("api/public/campaigns/<slug:slug>/donors/", public.public_donors_view),
    path("api/public/campaigns/<slug:slug>/donate/", public.public_donate_view),
    path("api/public/donations/lookup/", public.public_donation_lookup_view),
    path("api/public/donations/<str:public_id>/receipt/", public.donation_receipt_view),
    path("api/public/donations/<str:public_id>/receipt.pdf", public.donation_receipt_pdf_view),
    path("api/public/donations/<str:public_id>/", public.public_donation_status_view),
    path("api/public/parse-screenshot/", public.parse_screenshot_view),

    # SPA shell with per-campaign OG tags (deep-linkable share URLs)
    path("c/<slug:slug>", public.campaign_share_page),
    path("c/<slug:slug>/", public.campaign_share_page),
]
