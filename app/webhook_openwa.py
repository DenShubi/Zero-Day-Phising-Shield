"""
VisiKartika Shield - OpenWA (Baileys) WhatsApp Gateway Webhook (`/webhook/openwa`).

Flow (OpenWA v0.27 webhook contract, docs/06-api-specification.md §6.6):

    WhatsApp ─► OpenWA :2785 ──POST message.received──► /webhook/openwa
                                                         │ 200 OK immediately (no retry storm)
                                                         ▼ background task
                                      wa_triage.process_inbound()  (URL / IMAGE / COMMAND)
                                                         │
          ◄── send-text (report) + send-image (annotated bounding-box evidence, base64) ──┘

Why OpenWA instead of Fonnte: Fonnte's free plan delivers inbound photos as
"non-text message" without the image and cannot send media replies; OpenWA
inlines inbound media (≤ ~768 KiB) in the webhook and exposes a media download
route for larger files, and `send-image` accepts base64 so the annotated
evidence is delivered straight into the chat without a public URL.

Configuration (.env):
    OPENWA_API_URL          default http://localhost:2785
    OPENWA_API_KEY          required for replies (X-API-Key, role OPERATOR+)
    OPENWA_SESSION_ID       fallback when the payload has no sessionId
    OPENWA_WEBHOOK_SECRET   verifies X-OpenWA-Signature (HMAC-SHA256); required when the
                            webhook is reachable from outside localhost (tunnel / VPS)
    OPENWA_WEBHOOK_TOKEN    alternative: shared `?token=` for remote callers
    OPENWA_ALLOW_GROUPS     "true" to also answer in group chats (default false)
    OPENWA_SEND_EVIDENCE    "false" to disable sending the annotated image
"""

from __future__ import annotations

import base64
import os
import hashlib
import hmac
import json
import time
from collections import OrderedDict
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote

import httpx
from fastapi import APIRouter, BackgroundTasks, Request, Response

from app import security, wa_triage
from app.config import get_env

router = APIRouter(prefix="/webhook/openwa", tags=["OpenWA Gateway Webhook"])

INBOUND_EVENTS = {"message.received", "message", "message.any"}
MAX_EVIDENCE_BYTES = 4 * 1024 * 1024  # stay well under OpenWA's media cap
_DEDUPE_TTL_SEC = 15 * 60
_DEDUPE_MAX = 2048
_seen_keys: "OrderedDict[str, float]" = OrderedDict()


# --------------------------------------------------------------------------- #
# Config helpers (read lazily so .env edits apply without restart)
# --------------------------------------------------------------------------- #
def _api_base() -> str:
    return get_env("OPENWA_API_URL", default="http://localhost:2785").rstrip("/")


def _api_key() -> str:
    return get_env("OPENWA_API_KEY")


def _key_fingerprint() -> str:
    """Masked description of the key in use (never the key itself) for 401 troubleshooting."""
    key = _api_key()
    source = "variabel lingkungan Windows (MENIMPA .env!)" if os.environ.get("OPENWA_API_KEY", "").strip() else "file .env"
    return f"panjang={len(key)}, awal={key[:8]}, akhir={key[-4:]}, sumber={source}"


def _flag(name: str, default: bool) -> bool:
    raw = get_env(name, default="true" if default else "false").strip().lower()
    return raw in ("1", "true", "yes", "on")


def _headers() -> dict[str, str]:
    return {"X-API-Key": _api_key(), "Content-Type": "application/json"}


def normalize_chat_id(chat_id: str) -> str:
    """Keep full JIDs (`@c.us`, `@s.whatsapp.net`, `@lid`, `@g.us`); bare digits → `@c.us`."""
    cid = (chat_id or "").strip()
    if "@" in cid:
        return cid
    digits = "".join(ch for ch in cid if ch.isdigit())
    return f"{digits}@c.us" if digits else cid


# --------------------------------------------------------------------------- #
# Idempotency (OpenWA delivery is at-least-once)
# --------------------------------------------------------------------------- #
def _already_seen(key: str) -> bool:
    if not key:
        return False
    now = time.monotonic()
    while _seen_keys:
        oldest_key, ts = next(iter(_seen_keys.items()))
        if now - ts > _DEDUPE_TTL_SEC or len(_seen_keys) > _DEDUPE_MAX:
            _seen_keys.pop(oldest_key, None)
        else:
            break
    if key in _seen_keys:
        return True
    _seen_keys[key] = now
    return False


def verify_signature(raw_body: bytes, header_value: Optional[str], secret: str) -> bool:
    if not secret:
        return True
    if not header_value:
        return False
    expected = "sha256=" + hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header_value.strip())


# --------------------------------------------------------------------------- #
# Outbound API
# --------------------------------------------------------------------------- #
async def send_openwa_message(session_id: str, target_chat_id: str, message_text: str) -> bool:
    """POST /api/sessions/:sessionId/messages/send-text"""
    if not _api_key():
        print("[OpenWA] OPENWA_API_KEY belum diisi di .env — balasan tidak dikirim.")
        return False
    url = f"{_api_base()}/api/sessions/{quote(session_id, safe='')}/messages/send-text"
    payload = {"chatId": normalize_chat_id(target_chat_id), "text": message_text}
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(url, headers=_headers(), json=payload)
        print(f"[OpenWA send-text -> {security.mask_phone(payload['chatId'])}] HTTP {resp.status_code}: {resp.text[:160]}")
        if resp.status_code in (401, 403):
            print(f"[OpenWA] Key ditolak gateway -> key yang dipakai backend: {_key_fingerprint()}")
        return resp.status_code in (200, 201)
    except Exception as exc:  # noqa: BLE001
        print(f"[OpenWA send-text error] {type(exc).__name__}: {exc}")
        return False


async def send_openwa_image(
    session_id: str,
    target_chat_id: str,
    image_path: Path,
    caption: str = "",
) -> bool:
    """POST /api/sessions/:sessionId/messages/send-image with base64 (no public URL needed)."""
    if not _api_key():
        return False
    try:
        raw = image_path.read_bytes()
    except OSError as exc:
        print(f"[OpenWA send-image] cannot read evidence {image_path}: {exc}")
        return False
    if len(raw) > MAX_EVIDENCE_BYTES:
        raw = _shrink_to_jpeg(raw) or raw
        mimetype, filename = "image/jpeg", image_path.with_suffix(".jpg").name
    else:
        mimetype, filename = "image/png", image_path.name

    url = f"{_api_base()}/api/sessions/{quote(session_id, safe='')}/messages/send-image"
    payload = {
        "chatId": normalize_chat_id(target_chat_id),
        "base64": base64.b64encode(raw).decode("ascii"),
        "mimetype": mimetype,
        "filename": filename,
        "caption": caption[:1000],
    }
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(url, headers=_headers(), json=payload)
        print(f"[OpenWA send-image -> {security.mask_phone(payload['chatId'])}] HTTP {resp.status_code}: {resp.text[:160]}")
        return resp.status_code in (200, 201)
    except Exception as exc:  # noqa: BLE001
        print(f"[OpenWA send-image error] {type(exc).__name__}: {exc}")
        return False


def _shrink_to_jpeg(raw: bytes) -> Optional[bytes]:
    try:
        import cv2
        import numpy as np

        img = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            return None
        ok, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), 82])
        return buf.tobytes() if ok else None
    except Exception:  # noqa: BLE001
        return None


async def download_message_media(session_id: str, chat_id: str, message_id: str) -> Optional[bytes]:
    """GET /api/sessions/:sessionId/messages/:chatId/:messageId/media (used when media was omitted)."""
    if not (_api_key() and chat_id and message_id):
        return None
    url = (
        f"{_api_base()}/api/sessions/{quote(session_id, safe='')}/messages/"
        f"{quote(chat_id, safe='')}/{quote(message_id, safe='')}/media"
    )
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(url, headers={"X-API-Key": _api_key()})
        if resp.status_code == 200 and resp.content:
            ctype = resp.headers.get("content-type", "")
            if "application/json" in ctype:
                body = resp.json()
                data = body.get("data") or body.get("base64") or (body.get("media") or {}).get("data")
                return _b64_to_bytes(data) if data else None
            return resp.content
        print(f"[OpenWA media download] HTTP {resp.status_code}: {resp.text[:160]}")
    except Exception as exc:  # noqa: BLE001
        print(f"[OpenWA media download error] {type(exc).__name__}: {exc}")
    return None


def _b64_to_bytes(value: Any) -> Optional[bytes]:
    if not isinstance(value, str) or not value:
        return None
    try:
        return base64.b64decode(value.split(",", 1)[-1], validate=False)
    except Exception:  # noqa: BLE001
        return None


# --------------------------------------------------------------------------- #
# Payload parsing
# --------------------------------------------------------------------------- #
def parse_inbound(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Normalise an OpenWA webhook body into the fields the triage needs.
    Supports the documented flat message object and (defensively) raw Baileys
    `message.conversation / extendedTextMessage / imageMessage` shapes.
    """
    data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    raw_msg = data.get("message") if isinstance(data.get("message"), dict) else {}
    key = data.get("key") if isinstance(data.get("key"), dict) else {}

    chat_id = str(data.get("chatId") or key.get("remoteJid") or data.get("from") or "").strip()
    sender = str(data.get("senderPhone") or data.get("from") or data.get("author") or chat_id).strip()
    text = str(
        data.get("body")
        or data.get("text")
        or data.get("caption")
        or raw_msg.get("conversation")
        or (raw_msg.get("extendedTextMessage") or {}).get("text")
        or (raw_msg.get("imageMessage") or {}).get("caption")
        or ""
    ).strip()
    msg_type = str(data.get("type") or ("image" if raw_msg.get("imageMessage") else "")).lower()
    media = data.get("media") if isinstance(data.get("media"), dict) else None
    is_group = bool(data.get("isGroup")) or chat_id.endswith("@g.us") or str(data.get("kind", "")) == "group"
    kind = str(data.get("kind") or "")
    from_me = bool(data.get("fromMe") or key.get("fromMe"))

    return {
        "event": str(payload.get("event") or payload.get("type") or "").lower(),
        "session_id": str(payload.get("sessionId") or data.get("sessionId") or get_env("OPENWA_SESSION_ID") or ""),
        "message_id": str(data.get("id") or key.get("id") or ""),
        "chat_id": chat_id,
        "sender": sender,
        "text": text,
        "type": msg_type,
        "media": media,
        "is_group": is_group,
        "is_status": chat_id.endswith("@broadcast") or kind in ("status", "broadcast", "channel"),
        "from_me": from_me,
        "push_name": str((data.get("contact") or {}).get("pushName") or ""),
    }


def _is_image_media(parsed: dict[str, Any]) -> bool:
    media = parsed.get("media") or {}
    mimetype = str(media.get("mimetype") or "").lower()
    return mimetype.startswith("image/") or parsed.get("type") in ("image", "sticker")


async def build_inbound_message(parsed: dict[str, Any]) -> wa_triage.InboundMessage:
    media_bytes: Optional[bytes] = None
    unreadable = False
    media = parsed.get("media")
    if media:
        if _is_image_media(parsed):
            media_bytes = _b64_to_bytes(media.get("data"))
            if media_bytes is None:
                # Over WEBHOOK_MEDIA_INLINE_MAX_BYTES → `omitted: true`; fetch it from the gateway.
                media_bytes = await download_message_media(
                    parsed["session_id"], parsed["chat_id"], parsed["message_id"]
                )
            unreadable = media_bytes is None
        else:
            unreadable = not parsed.get("text")  # e.g. voice note / document without text
    elif parsed.get("type") == "image":
        media_bytes = await download_message_media(parsed["session_id"], parsed["chat_id"], parsed["message_id"])
        unreadable = media_bytes is None

    return wa_triage.InboundMessage(
        channel="OPENWA",
        sender=parsed.get("push_name") or parsed.get("sender") or "Prajurit",
        text=parsed.get("text") or "",
        media_bytes=media_bytes,
        media_mimetype=(media or {}).get("mimetype"),
        has_unreadable_media=unreadable,
    )


# --------------------------------------------------------------------------- #
# Processing
# --------------------------------------------------------------------------- #
async def handle_parsed_message(parsed: dict[str, Any], send_replies: bool = True) -> wa_triage.TriageResult:
    """Triage one parsed inbound message and deliver the replies through OpenWA."""
    t0 = time.perf_counter()
    msg = await build_inbound_message(parsed)
    session_id, chat_id = parsed["session_id"], parsed["chat_id"]

    async def _ack(kind: str) -> None:
        ack = wa_triage.scanning_ack(kind)
        if send_replies and ack:
            await send_openwa_message(session_id, chat_id, ack)

    result = await wa_triage.process_inbound(msg, on_scan_start=_ack)

    if send_replies and result.reply_text:
        await send_openwa_message(session_id, chat_id, result.reply_text)
        evidence = result.evidence_image_path
        if (
            _flag("OPENWA_SEND_EVIDENCE", True)
            and evidence is not None
            and evidence.exists()
            and result.scan_meta
        ):
            await send_openwa_image(
                session_id,
                chat_id,
                evidence,
                caption=wa_triage.format_evidence_caption(
                    result.scan_meta.get("verdict", ""),
                    float(result.scan_meta.get("total_risk_score") or 0.0),
                    result.kind,
                ),
            )
    print(
        f"[OpenWA] {parsed['message_id'] or '-'} from {security.mask_phone(parsed['sender'])} → {result.kind} "
        f"in {time.perf_counter() - t0:.2f}s"
    )
    return result


def _skip_reason(parsed: dict[str, Any]) -> Optional[str]:
    event = parsed["event"]
    if event and event not in INBOUND_EVENTS:
        return f"event:{event}"
    if parsed["from_me"]:
        return "outgoing_message"
    if parsed["is_status"]:
        return "status_or_broadcast"
    if parsed["is_group"] and not _flag("OPENWA_ALLOW_GROUPS", False):
        return "group_chat_disabled"
    if not parsed["chat_id"]:
        return "missing_chat_id"
    if not parsed["session_id"]:
        return "missing_session_id"
    return None


async def _background_handle(parsed: dict[str, Any]) -> None:
    try:
        await handle_parsed_message(parsed)
    except Exception as exc:  # noqa: BLE001 - never crash the worker
        print(f"[OpenWA background error] {type(exc).__name__}: {exc}")


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
@router.get("")
@router.get("/")
async def openwa_webhook_status() -> dict[str, Any]:
    return {
        "status": "active",
        "service": "VisiKartika Shield - OpenWA Baileys Webhook",
        "openwa_api": _api_base(),
        "api_key_configured": bool(_api_key()),
        "default_session_configured": bool(get_env("OPENWA_SESSION_ID")),
        "signature_verification": bool(get_env("OPENWA_WEBHOOK_SECRET")),
        "remote_callers_allowed": bool(get_env("OPENWA_WEBHOOK_SECRET") or get_env("OPENWA_WEBHOOK_TOKEN")),
        "groups_enabled": _flag("OPENWA_ALLOW_GROUPS", False),
        "send_evidence_image": _flag("OPENWA_SEND_EVIDENCE", True),
        "accepted_events": sorted(INBOUND_EVENTS),
    }


@router.post("")
@router.post("/")
async def handle_openwa_inbound(
    request: Request,
    background_tasks: BackgroundTasks,
    response: Response,
    sync: bool = False,
    dry_run: bool = False,
) -> dict[str, Any]:
    """
    Inbound webhook receiver from OpenWA.

    * Acknowledges immediately (HTTP 200) and runs the scan in a background task,
      so slow scans never hit OpenWA's WEBHOOK_TIMEOUT and trigger duplicate retries.
    * `?sync=true` processes inline and returns the reply (for Postman / tests).
    * `?dry_run=true` (with sync) skips sending anything back to WhatsApp.
    """
    raw_body = await request.body()
    secret = get_env("OPENWA_WEBHOOK_SECRET")
    if secret:
        if not verify_signature(raw_body, request.headers.get("X-OpenWA-Signature"), secret):
            response.status_code = 401
            return {"status": False, "error": "invalid signature"}
    elif not (security.is_loopback_request(request) or security.check_shared_token(request, "OPENWA_WEBHOOK_TOKEN")):
        # Without a secret only the local OpenWA process may call us; otherwise anyone on the
        # internet could make the bot send WhatsApp messages to arbitrary numbers.
        response.status_code = 401
        return {"status": False, "error": "unauthorized: set OPENWA_WEBHOOK_SECRET or call from localhost"}

    try:
        payload = json.loads(raw_body or b"{}")
        if not isinstance(payload, dict):
            raise ValueError("payload must be an object")
    except Exception:  # noqa: BLE001
        response.status_code = 400
        return {"status": False, "error": "Invalid JSON"}

    parsed = parse_inbound(payload)
    skip = _skip_reason(parsed)
    if skip:
        return {"status": True, "skipped": skip}

    dedupe_key = (
        request.headers.get("X-OpenWA-Idempotency-Key")
        or str(payload.get("idempotencyKey") or "")
        or (f"{parsed['session_id']}:{parsed['message_id']}" if parsed["message_id"] else "")
    )
    if _already_seen(dedupe_key):
        return {"status": True, "skipped": "duplicate_delivery"}

    print(
        f"[OpenWA inbound] {parsed['event'] or '-'} from {security.mask_phone(parsed['sender'])} chat={security.mask_phone(parsed['chat_id'])} "
        f"type={parsed['type'] or 'text'} media={'yes' if parsed['media'] else 'no'} text='{parsed['text'][:80]}'"
    )

    if sync:
        result = await handle_parsed_message(parsed, send_replies=not dry_run)
        return {
            "status": True,
            "triage": result.kind,
            "reply": result.reply_text,
            "evidence_image": str(result.evidence_image_path) if result.evidence_image_path else None,
            "scan": result.scan_meta,
        }

    background_tasks.add_task(_background_handle, parsed)
    return {"status": True, "queued": True, "triage_hint": _triage_hint(parsed)}


def _triage_hint(parsed: dict[str, Any]) -> str:
    """Cheap lane prediction for the HTTP response (media is not downloaded here)."""
    if parsed["media"] or parsed["type"] == "image":
        return "IMAGE" if _is_image_media(parsed) else "MEDIA_UNREADABLE"
    kind, _ = wa_triage.classify_message(
        wa_triage.InboundMessage(channel="OPENWA", sender="", text=parsed["text"])
    )
    return kind


__all__ = [
    "router",
    "send_openwa_message",
    "send_openwa_image",
    "download_message_media",
    "parse_inbound",
    "verify_signature",
    "normalize_chat_id",
]
