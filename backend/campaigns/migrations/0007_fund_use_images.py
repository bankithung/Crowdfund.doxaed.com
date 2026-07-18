# FundUse grows from one photo to many: create the image table, move each
# existing photo into it, then drop the old column. Order matters — data
# is copied before the field is removed.

import campaigns.models
import django.db.models.deletion
from django.db import migrations, models


def copy_images_forward(apps, schema_editor):
    FundUse = apps.get_model("campaigns", "FundUse")
    FundUseImage = apps.get_model("campaigns", "FundUseImage")
    for fund_use in FundUse.objects.exclude(image=""):
        FundUseImage.objects.create(fund_use=fund_use, image=fund_use.image,
                                    position=1)


def copy_images_backward(apps, schema_editor):
    FundUse = apps.get_model("campaigns", "FundUse")
    FundUseImage = apps.get_model("campaigns", "FundUseImage")
    for img in FundUseImage.objects.order_by("fund_use_id", "position", "id"):
        fund_use = FundUse.objects.get(pk=img.fund_use_id)
        if not fund_use.image:
            fund_use.image = img.image
            fund_use.save(update_fields=["image"])


class Migration(migrations.Migration):

    dependencies = [
        ("campaigns", "0006_fund_use"),
    ]

    operations = [
        migrations.CreateModel(
            name="FundUseImage",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True,
                                           serialize=False, verbose_name="ID")),
                ("image", models.ImageField(upload_to=campaigns.models.cover_upload_path)),
                ("position", models.PositiveIntegerField(default=0)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("fund_use", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="images", to="campaigns.funduse")),
            ],
            options={"ordering": ["position", "id"]},
        ),
        migrations.RunPython(copy_images_forward, copy_images_backward),
        migrations.RemoveField(model_name="funduse", name="image"),
    ]
