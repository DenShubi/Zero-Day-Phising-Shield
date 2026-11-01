import base64
import os
import re
from typing import Any, Optional
import httpx
from fastapi import APIRouter, Request

from app.config import BASE_DIR, get_env
from app.sandbox.browser import OFFICIAL_MIL_DOMAINS
from app.scanner_service import execute_image_scan, execute_phase2_scan
from app.supabase_client import SupabaseService
from app.webhook_wa import (
    _format_emergency_guide,
    _format_help_menu,
    _format_official_portals,
    _format_system_status,
    _format_wa_image_report,
    _format_wa_scan_report,
    extract_target_url,
    is_direct_image_url,
)

router = APIRouter(prefix="/webhook/openwa", tags=["OpenWA Gateway Webhook"])

OPENWA_API_BASE = get_env("OPENWA_API_URL", default="http://localhost:2785").rstrip("/")
OPENWA_API_KEY = get_env("OPENWA_API_KEY", default="owa_k1_5b5ce58743ea0f17acfa0703782a5d7771a142c495c87d973627c95e823470dd")


async def send_openwa_message(
    session_id: str,
    target_chat_id: str,
    message_text: str,
) -> bool:
    """Send WhatsApp reply message via OpenWA session message API."""
    clean_target = target_chat_id
    if not clean_target.endswith("@c.us") and not clean_target.endswith("@s.whatsapp.net"):
        digits = re.sub(r"\D", "", clean_target)
        clean_target = f"{digits}@c.us"

    url = f"{OPENWA_API_BASE}/api/sessions/{session_id}/messages/send-text"
    headers = {
        "X-API-Key": OPENWA_API_KEY,
        "Content-Type": "application/json",
    }
    payload = {
        "chatId": clean_target,
        "text": message_text,
    }

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(url, headers=headers, json=payload)
            print(f"[OpenWA Outbound -> {clean_target}] HTTP {resp.status_code}: {resp.text[:120]}")
            return resp.status_code in (200, 201)
    except Exception as exc:
        print(f"[OpenWA Outbound Error] {exc}")
        return False


@router.get("")
@router.get("/")
async def openwa_webhook_status():
    return {
        "status": "active",
        "service": "VisiKartika Shield - OpenWA Baileys Webhook",
        "openwa_api": OPENWA_API_BASE,
    }


@router.post("")
@router.post("/")
async def handle_openwa_inbound(request: Request):
    """
    Inbound webhook receiver from OpenWA gateway.
    Handles incoming messages (text, URLs, and real uncompressed images/media buffers).
    """
    try:
        payload = await request.json()
    except Exception:
        return {"status": False, "error": "Invalid JSON"}

    event = str(payload.get("event") or payload.get("type") or "").lower()
    data = payload.get("data") or payload
    session_id = str(payload.get("sessionId") or data.get("sessionId") or "91947795-3e28-4069-b8cc-c928a692b0f6")

    print(f"[OpenWA Webhook Event] {event} | Payload keys: {list(payload.keys())}")

    # Only process incoming message events
    if event and not any(k in event for k in ("message", "chat", "inbound")):
        return {"status": True, "skipped_event": event}

    from_me = bool(
        data.get("fromMe")
        or data.get("key", {}).get("fromMe", False)
        or (isinstance(data.get("message"), dict) and data.get("message", {}).get("key", {}).get("fromMe", False))
    )
    if from_me:
        return {"status": True, "skipped": "outgoing_message"}

    sender = str(
        data.get("from")
        or data.get("sender")
        or data.get("chatId")
        or data.get("key", {}).get("remoteJid")
        or ""
    ).strip()

    # Extract body from different Baileys message structures
    msg_obj = data.get("message") if isinstance(data.get("message"), dict) else {}
    message = str(
        data.get("body")
        or data.get("text")
        or msg_obj.get("conversation")
        or msg_obj.get("extendedTextMessage", {}).get("text")
        or msg_obj.get("imageMessage", {}).get("caption")
        or ""
    ).strip()

    media_bytes: Optional[bytes] = None
    media_url: Optional[str] = None

    # Check for imageMessage in Baileys payload or OpenWA media attachment
    image_msg = msg_obj.get("imageMessage")
    if image_msg:
        # If OpenWA already downloaded to media directory or provided url
        media_url = image_msg.get("url") or image_msg.get("directPath")

    media_data = data.get("media") or data.get("attachment")
    if isinstance(media_data, dict):
        if media_data.get("url"):
            media_url = media_data["url"]
        elif media_data.get("data"):
            try:
                media_bytes = base64.b64decode(media_data["data"])
            except Exception:
                pass
    elif isinstance(media_data, str) and media_data.startswith("data:image"):
        try:
            b64_part = media_data.split(",")[-1]
            media_bytes = base64.b64decode(b64_part)
        except Exception:
            pass

    print(f"[OpenWA Inbound Message] From: {sender} | Msg: '{message}' | Media: {'YES' if media_bytes or media_url else 'NO'}")

    reply_text = ""
    scan_meta = None
    normalized_cmd = message.lower().strip().lstrip("/")
    extracted_url = extract_target_url(message)

    if not media_url and extracted_url and is_direct_image_url(extracted_url):
        media_url = extracted_url

    # 1. Image / Quishing Scan (Full dynamic image support!)
    if media_bytes or media_url:
        try:
            img_res = await execute_image_scan(
                image_bytes=media_bytes,
                image_url=media_url,
                caption=message,
                reporter_source="WHATSAPP_BOT",
                reporter_unit=f"OpenWA ({sender or 'Prajurit'})",
            )
            reply_text = _format_wa_image_report(img_res)
            scan_meta = {
                "triage": "IMAGE",
                "verdict": img_res.verdict,
                "score": img_res.total_risk_score,
            }
        except Exception as exc:
            reply_text = "⚠️ Gagal menganalisis gambar dengan Computer Vision."
            print(f"[OpenWA Image Error] {exc}")

    # 2. URL Sandbox Scan
    elif extracted_url:
        try:
            scan_res = await execute_phase2_scan(
                target_url=extracted_url,
                reporter_source="WHATSAPP_BOT",
                reporter_unit=f"OpenWA ({sender or 'Prajurit'})",
            )
            reply_text = _format_wa_scan_report(scan_res)
            scan_meta = {
                "triage": "URL",
                "verdict": scan_res.verdict,
                "score": scan_res.total_risk_score,
            }
        except Exception as exc:
            reply_text = f"⚠️ Gagal mengakses tautan target: `{extracted_url}`"
            print(f"[OpenWA URL Error] {exc}")

    # 3. Interactive Commands
    elif normalized_cmd in ("portal", "domain", "resmi", "whitelist"):
        reply_text = _format_official_portals()
    elif normalized_cmd in ("status", "cek status", "info sistem", "health"):
        reply_text = await _format_system_status()
    elif normalized_cmd in ("darurat", "lapor", "sos", "bocor", "mitigasi"):
        reply_text = _format_emergency_guide()
    elif message:
        reply_text = _format_help_menu()

    if reply_text and sender:
        await send_openwa_message(
            session_id=session_id,
            target_chat_id=sender,
            message_text=reply_text,
        )

    return {"status": True, "reply": reply_text, "scan": scan_meta}
