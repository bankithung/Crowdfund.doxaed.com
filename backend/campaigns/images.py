"""Upload sanitization: every image is validated with Pillow and re-encoded
from scratch (EXIF/metadata stripped, size clamped, random filename), so no
user-controlled bytes are ever served back verbatim."""

import secrets
from io import BytesIO

from django.core.files.base import ContentFile
from PIL import Image, ImageOps, UnidentifiedImageError

Image.MAX_IMAGE_PIXELS = 40_000_000  # decompression-bomb guard

MAX_UPLOAD_BYTES = 6 * 1024 * 1024
ALLOWED_FORMATS = {"PNG", "JPEG", "WEBP"}


class ImageError(ValueError):
    pass


def process_image(uploaded, *, max_dim=2000, force="auto", quality=88):
    """Validate + re-encode an upload.

    force: 'png' (lossless, used for QR codes), 'jpeg', or 'auto'
    (PNG when the image has transparency, JPEG otherwise).
    Returns (ContentFile, extension).
    """
    if uploaded.size > MAX_UPLOAD_BYTES:
        raise ImageError("Image is too large — maximum size is 6 MB.")

    try:
        probe = Image.open(uploaded)
        probe.verify()
        uploaded.seek(0)
        img = Image.open(uploaded)
        img.load()
    except (UnidentifiedImageError, OSError, ValueError):
        raise ImageError("That file isn't a valid image. Please upload a PNG, JPEG or WEBP.")

    if (img.format or "").upper() not in ALLOWED_FORMATS:
        raise ImageError("Unsupported image type. Please upload a PNG, JPEG or WEBP.")

    img = ImageOps.exif_transpose(img)

    if max(img.size) > max_dim:
        img.thumbnail((max_dim, max_dim), Image.LANCZOS)

    has_alpha = (
        img.mode in ("RGBA", "LA")
        or (img.mode == "P" and "transparency" in img.info)
    )
    if force == "png":
        out_format = "PNG"
    elif force == "jpeg":
        out_format = "JPEG"
    else:
        out_format = "PNG" if has_alpha else "JPEG"

    if out_format == "JPEG":
        if img.mode != "RGB":
            background = Image.new("RGB", img.size, (255, 255, 255))
            rgba = img.convert("RGBA")
            background.paste(rgba, mask=rgba.getchannel("A"))
            img = background
        buf = BytesIO()
        img.save(buf, "JPEG", quality=quality, optimize=True)
        ext = "jpg"
    else:
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGBA" if has_alpha else "RGB")
        buf = BytesIO()
        img.save(buf, "PNG", optimize=True)
        ext = "png"

    name = f"{secrets.token_hex(16)}.{ext}"
    return ContentFile(buf.getvalue(), name=name), ext


def decode_qr_payload(content_file):
    """Extract the encoded string from an uploaded QR image (e.g. the
    upi://pay?... URI). Used so the mobile deep-link button carries the EXACT
    payload a camera scan would — UPI apps rate app-constructed intent links
    far more strictly than scanned payloads. Returns '' when undecodable."""
    try:
        from pyzbar.pyzbar import decode as zbar_decode
        image = Image.open(BytesIO(content_file.file.getvalue())
                           if hasattr(content_file.file, "getvalue")
                           else content_file)
        results = [r for r in zbar_decode(image) if r.type == "QRCODE"]
        if not results:
            return ""
        payload = results[0].data.decode("utf-8", "ignore").strip()
        return payload[:1000]
    except Exception:
        return ""


def delete_file_quiet(field_file):
    """Remove a FieldFile from storage, ignoring races/missing files."""
    if not field_file:
        return
    try:
        field_file.delete(save=False)
    except OSError:
        pass
