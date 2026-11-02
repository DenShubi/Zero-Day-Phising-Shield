"""
LEGACY WhatsApp gateway: Fonnte (`/webhook/wa`).

Kept for backward compatibility & existing tests. The active gateway is OpenWA
(`app/webhook_openwa.py`) because Fonnte's free plan cannot deliver inbound
images nor send media replies. Triage logic is shared via `app/wa_triage.py`.
"""

import base64
import json
from pathlib import Path
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app import security, wa_triage
from app.config import BASE_DIR, get_env
from app.wa_triage import extract_target_url, is_direct_image_url  # noqa: F401  (re-export)

router = APIRouter(prefix="/webhook/wa", tags=["WhatsApp Webhook (Legacy Fonnte)"])

MOCK_TARGETS_DIR = BASE_DIR / "mock_targets"
DEFAULT_DEMO_POSTER = BASE_DIR / "mock_targets" / "assets" / "poster_quishing_bintara.png"


async def send_whatsapp_message(
    target: str,
    message_text: str,
    media_url: Optional[str] = None,
) -> bool:
    """
    Send WhatsApp message (and optional annotated bounding-box evidence image)
    using Fonnte API.
    """
    fonnte_token = get_env("FONNTE_TOKEN")
    if not fonnte_token:
        print("[WA Warning] FONNTE_TOKEN kosong di .env")
        return False

    url = "https://api.fonnte.com/send"
    headers = {"Authorization": fonnte_token}
    payload: dict[str, str] = {
        "target": target,
        "message": message_text,
    }
    if media_url and media_url.startswith("https://") and "localhost" not in media_url:
        payload["url"] = media_url

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(url, headers=headers, data=payload)
            print(f"[WA Outbound -> {security.mask_phone(target)}] HTTP {resp.status_code}: {resp.text[:200]}")
            if resp.status_code == 200:
                try:
                    return bool(resp.json().get("status", True))
                except Exception:
                    return True
            return False
    except Exception as exc:
        print(f"[WA Error] Failed to send to {security.mask_phone(target)}: {type(exc).__name__}: {exc!r}")
        return False


# Backward-compatible aliases (formatters now live in app/wa_triage.py)
_format_help_menu = wa_triage.format_help_menu
_format_official_portals = wa_triage.format_official_portals
_format_emergency_guide = wa_triage.format_emergency_guide
_format_system_status = wa_triage.format_system_status
_format_wa_scan_report = wa_triage.format_url_report
_format_wa_image_report = wa_triage.format_image_report


def _resolve_fonnte_media(media_url: str) -> tuple[Optional[str], Optional[Path]]:
    """
    Accept Fonnte attachment URLs (http/https). Local paths are only honoured
    when they point inside `mock_targets/` (demo assets), never arbitrary files.
    Returns `(remote_url, trusted_local_path)`.
    """
    if not media_url:
        return None, None
    if media_url.lower().startswith(("http://", "https://")):
        return media_url, None
    candidate = Path(media_url[7:] if media_url.lower().startswith("file://") else media_url)
    if not candidate.is_absolute():
        candidate = BASE_DIR / candidate
    try:
        resolved = candidate.resolve()
        if resolved.is_file() and resolved.is_relative_to(MOCK_TARGETS_DIR.resolve()):
            return None, resolved
    except (OSError, ValueError):
        pass
    print(f"[WA Fonnte] Refused non-demo local media path: {media_url}")
    return None, None


@router.get("")
@router.get("/")
async def webhook_health():
    """Health check endpoint for WhatsApp Webhook."""
    return {
        "status": "active",
        "service": "VisiKartika Shield - WhatsApp Lapor Cepat Webhook",
        "fonnte_configured": bool(get_env("FONNTE_TOKEN")),
        "supported_triage": ["IMAGE_AND_QUISHING", "URL_SANDBOX", "TACTICAL_COMMANDS"],
        "supported_commands": ["help", "portal", "status", "darurat", "<url>", "<image>"],
    }


@router.post("")
@router.post("/")
async def fonnte_webhook(request: Request):
    """
    Webhook receiver & Triage Router for incoming WhatsApp messages via Fonnte.
    - Triage 1 (Image / Screenshot / QR Poster): Jika terdapat lampiran gambar (`url`/`attachment`),
      atau pesan `non-text message` dari Fonnte Free Plan saat gambar dikirim,
      atau tautan berakhiran `.png/.jpg/.webp`, jalankan `execute_image_scan`.
    - Triage 2 (Website URL): Jika pesan mengandung tautan web, jalankan `execute_phase2_scan`.
    - Triage 3 (Command): Komando informasi profesional (`help`, `portal`, `status`, `darurat`).
    """
    if not (security.is_loopback_request(request) or security.check_shared_token(request, "FONNTE_WEBHOOK_TOKEN")):
        return JSONResponse(status_code=401, content={"status": False, "error": "unauthorized"})

    sender = ""
    message = ""
    media_attachment_url = ""
    media_base64 = ""
    msg_type = ""
    raw_dict: dict[str, Any] = {}

    # Fonnte can send form-encoded data or JSON
    content_type = request.headers.get("content-type", "")
    if "application/json" in content_type:
        try:
            body = await request.json()
            if isinstance(body, dict):
                raw_dict = body
        except Exception:
            pass
    else:
        try:
            form = await request.form()
            raw_dict = {k: str(v) for k, v in form.items()}
        except Exception:
            pass

    sender = str(raw_dict.get("sender") or raw_dict.get("pengirim") or "").strip()
    message = str(raw_dict.get("message") or raw_dict.get("pesan") or "").strip()
    media_attachment_url = str(
        raw_dict.get("url")
        or raw_dict.get("attachment")
        or raw_dict.get("image_url")
        or raw_dict.get("file")
        or ""
    ).strip()
    media_base64 = str(raw_dict.get("buffer") or raw_dict.get("image_base64") or "").strip()
    msg_type = str(raw_dict.get("type") or "").strip().lower()

    # Debug dump is opt-in (WA_DEBUG_PAYLOAD=true) and phone numbers are masked:
    # the old always-on dump leaked personal numbers into git.
    if get_env("WA_DEBUG_PAYLOAD", default="false").lower() in ("1", "true", "yes"):
        try:
            masked = {k: security.mask_phone(v) if isinstance(v, str) else v for k, v in raw_dict.items()}
            debug_file = BASE_DIR / "storage" / "last_wa_payload.json"
            debug_file.write_text(json.dumps(masked, indent=2, default=str), encoding="utf-8")
        except Exception:
            pass

    print(
        f"[WA Webhook Inbound] From: {security.mask_phone(sender)} | Type: {msg_type or 'text'} | Message: {message} | Media: {media_attachment_url or '-'}"
    )

    normalized_cmd = message.lower().strip().lstrip("/")

    # Fonnte Free Tier sends `message = "non-text message"` (with empty `url`) when a user
    # sends a photo: fall back to the built-in demo poster so the flow can still be shown.
    is_fonnte_non_text_image = (
        normalized_cmd in ("non-text message", "non text message", "image", "gambar", "foto", "qr")
        or msg_type in ("image", "media", "photo", "picture")
    )
    remote_media, local_media = _resolve_fonnte_media(media_attachment_url)
    if is_fonnte_non_text_image and not remote_media and not local_media and not media_base64:
        if DEFAULT_DEMO_POSTER.exists():
            local_media = DEFAULT_DEMO_POSTER

    media_bytes: Optional[bytes] = None
    if media_base64:
        try:
            media_bytes = base64.b64decode(media_base64.split(",")[-1])
        except Exception:
            media_bytes = None

    result = await wa_triage.process_inbound(
        wa_triage.InboundMessage(
            channel="FONNTE",
            sender=sender,
            text=message,
            media_bytes=media_bytes,
            media_url=remote_media,
            trusted_local_image=local_media,
        )
    )
    reply_text = result.reply_text
    outbound_media_url = result.evidence_image_url
    scan_meta = result.scan_meta
    # Fonnte cannot upload local files, so expose the public evidence link in the text instead.
    if outbound_media_url and wa_triage._is_public_evidence_url(outbound_media_url):
        reply_text += f"\n\n🖼️ *Bukti Visual*: {outbound_media_url}"

    if reply_text and sender:
        await send_whatsapp_message(
            target=sender,
            message_text=reply_text,
            media_url=outbound_media_url,
        )

    response_payload = {
        "status": True,
        "reply": reply_text,
    }
    if scan_meta is not None:
        response_payload["scan"] = scan_meta
    return response_payload
