import re
import httpx
from fastapi import APIRouter, Request

from app.config import get_env
from app.scanner_service import execute_phase2_scan

router = APIRouter(prefix="/webhook/wa", tags=["WhatsApp Webhook"])

URL_REGEX = re.compile(r"(?:https?|file)://[^\s<>\"']+", re.IGNORECASE)


async def send_whatsapp_message(target: str, message_text: str) -> bool:
    """Send WhatsApp message using Fonnte API."""
    fonnte_token = get_env("FONNTE_TOKEN")
    if not fonnte_token:
        print("[WA Warning] FONNTE_TOKEN kosong di .env")
        return False

    url = "https://api.fonnte.com/send"
    headers = {"Authorization": fonnte_token}
    payload = {
        "target": target,
        "message": message_text,
    }
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(url, headers=headers, data=payload)
            print(f"[WA Outbound -> {target}] HTTP {resp.status_code}: {resp.text[:200]}")
            if resp.status_code == 200:
                try:
                    return bool(resp.json().get("status", True))
                except Exception:
                    return True
            return False
    except Exception as exc:
        print(f"[WA Error] Failed to send to {target}: {type(exc).__name__}: {exc!r}")
        return False


def _format_wa_scan_report(scan_res) -> str:
    """Format tactical PUSSIBERAD WhatsApp threat response for soldiers in the field."""
    if scan_res.verdict == "CRITICAL_PHISHING":
        header = "🚨 *PERINGATAN KRITIS: PHISHING TERDETEKSI!*"
        advice = "⛔ *TINDAKAN*: JANGAN masukkan NRP, NIK, kata sandi, atau kode OTP! Insiden telah diteruskan ke SOC PUSSIBERAD."
    elif scan_res.verdict == "SUSPICIOUS":
        header = "⚠️ *WASPADA: TAUTAN MENCURIGAKAN*"
        advice = "⚠️ *TINDAKAN*: Hindari mengisi data pribadi pada tautan ini sebelum diverifikasi satuan siber."
    else:
        header = "✅ *AMAN: PORTAL RESMI TERVERIFIKASI*"
        advice = "✅ *INFO*: Domain terkonfirmasi resmi di dalam namespace pertahanan/militer RI."

    lines = [
        header,
        "",
        f"🔗 *URL*: {scan_res.final_url}",
        f"📊 *Skor Risiko*: *{scan_res.total_risk_score:.1f}/100* ({scan_res.verdict})",
    ]
    if scan_res.impersonated_target and scan_res.verdict != "SAFE":
        lines.append(f"🎭 *Target Tiruan*: {scan_res.impersonated_target}")
    if scan_res.detected_logos:
        brands = ", ".join({lg.brand_name for lg in scan_res.detected_logos})
        lines.append(f"🛡️ *Logo Terdeteksi*: {brands}")
    if scan_res.risk_analysis.forensic_reasons:
        top_reasons = scan_res.risk_analysis.forensic_reasons[:2]
        lines.append("🔍 *Temuan Forensik*:")
        for reason in top_reasons:
            lines.append(f"  - {reason}")
    lines.extend(["", advice])
    return "\n".join(lines)


@router.get("")
@router.get("/")
async def webhook_health():
    """Health check endpoint for WhatsApp Webhook."""
    return {
        "status": "active",
        "service": "VisiKartika Shield - WhatsApp Lapor Cepat Webhook",
        "device": "085179743602",
        "fonnte_configured": bool(get_env("FONNTE_TOKEN")),
    }


@router.post("")
@router.post("/")
async def fonnte_webhook(request: Request):
    """
    Webhook receiver for incoming WhatsApp messages via Fonnte.
    - Phase 1 Sync: Menerima 'ping' dan membalas 'Pong'.
    - Phase 2 Triage: Mendeteksi URL otomatis, memindai via Sandbox + Vision,
      mencatat ke Supabase Realtime, dan membalas laporan ancaman ke prajurit.
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
    scan_meta = None

    # Check 1: Titik Sinkronisasi Ping -> Pong
    if message.lower() == "ping":
        reply_text = "Pong"
    elif message.lower() in ("help", "bantuan", "info"):
        reply_text = (
            "🛡️ *PUSSIBERAD TNI AD - Lapor Cepat*\n\n"
            "Kirimkan tautan mencurigakan (`https://...`) untuk dipindai otomatis oleh VisiKartika Shield, "
            "atau ketik *ping* untuk cek konektivitas bot."
        )
    else:
        # Check 2: Triage Router — Deteksi URL di dalam pesan prajurit
        url_match = URL_REGEX.search(message)
        if url_match:
            extracted_url = url_match.group(0).rstrip(".,);]")
            try:
                scan_res = await execute_phase2_scan(
                    target_url=extracted_url,
                    reporter_source="WHATSAPP_BOT",
                    reporter_unit=f"WA Lapor Cepat ({sender or 'Anonim'})",
                )
                reply_text = _format_wa_scan_report(scan_res)
                scan_meta = {
                    "scan_id": scan_res.scan_id,
                    "verdict": scan_res.verdict,
                    "total_risk_score": scan_res.total_risk_score,
                    "supabase_synced": scan_res.supabase_synced,
                }
            except Exception as exc:
                reply_text = (
                    "⚠️ *PUSSIBERAD Sandbox*: Gagal mengakses tautan target "
                    f"(`{extracted_url}`). Kemungkinan server target tidak aktif atau diblokir."
                )
                print(f"[WA Scan Error] {extracted_url}: {exc}")

    if reply_text and sender:
        await send_whatsapp_message(target=sender, message_text=reply_text)

    response_payload = {
        "status": True,
        "reply": reply_text,
    }
    if scan_meta is not None:
        response_payload["scan"] = scan_meta
    return response_payload
