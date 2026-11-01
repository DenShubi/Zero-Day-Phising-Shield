import os
import httpx
from fastapi import APIRouter, Request
from dotenv import load_dotenv

load_dotenv()

router = APIRouter(prefix="/webhook/wa", tags=["WhatsApp Webhook"])

FONNTE_TOKEN = os.getenv("FONNTE_TOKEN", "")



async def send_whatsapp_message(target: str, message_text: str) -> bool:
    """Send WhatsApp message using Fonnte API."""
    url = "https://api.fonnte.com/send"
    headers = {"Authorization": FONNTE_TOKEN}
    payload = {
        "target": target,
        "message": message_text,
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, headers=headers, data=payload)
            return resp.status_code == 200
    except Exception as exc:
        print(f"[WA Error] Failed to send to {target}: {exc}")
        return False


@router.get("")
@router.get("/")
async def webhook_health():
    """Health check endpoint for WhatsApp Webhook."""
    return {
        "status": "active",
        "service": "VisiKartika Shield - WhatsApp Lapor Cepat Webhook",
        "device": "085179743602",
    }


@router.post("")
@router.post("/")
async def fonnte_webhook(request: Request):
    """
    Webhook receiver for incoming WhatsApp messages via Fonnte.
    Titik Sinkronisasi Phase 1: Menerima 'ping' dan membalas 'Pong'.
    """
    sender = ""
    message = ""

    # Fonnte can send form-encoded data or JSON
    content_type = request.headers.get("content-type", "")
    if "application/json" in content_type:
        try:
            body = await request.json()
            sender = str(body.get("sender", "")).strip()
            message = str(body.get("message", "")).strip()
        except Exception:
            pass
    else:
        try:
            form = await request.form()
            sender = str(form.get("sender", "")).strip()
            message = str(form.get("message", "")).strip()
        except Exception:
            pass

    print(f"[WA Webhook Inbound] From: {sender} | Message: {message}")

    reply_text = ""

    # Check 1: Titik Sinkronisasi Ping -> Pong
    if message.lower() == "ping":
        reply_text = "Pong"
    elif message.lower() in ("help", "bantuan", "info"):
        reply_text = (
            "🛡️ *PUSSIBERAD TNI AD - Lapor Cepat*\n\n"
            "Kirimkan tautan mencurigakan atau ketik *ping* untuk cek konektivitas bot."
        )

    if reply_text and sender:
        # Send reply back to user on WhatsApp
        await send_whatsapp_message(target=sender, message_text=reply_text)

    return {
        "status": True,
        "reply": reply_text,
    }
