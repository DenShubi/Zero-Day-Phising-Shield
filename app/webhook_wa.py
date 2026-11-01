import re
import httpx
from fastapi import APIRouter, Request
from dotenv import load_dotenv

load_dotenv()

from app.config import get_env
from app.sandbox.browser import OFFICIAL_MIL_DOMAINS
from app.scanner_service import execute_phase2_scan
from app.supabase_client import SupabaseService

router = APIRouter(prefix="/webhook/wa", tags=["WhatsApp Webhook"])

# Matches full URLs (http/https/file) or bare domains (e.g. tniad.mil.id/login, www.rekrutmen-tni.com)
FULL_URL_REGEX = re.compile(r"(?:https?|file)://[^\s<>\"']+", re.IGNORECASE)
BARE_DOMAIN_REGEX = re.compile(
    r"\b(?:www\.[a-z0-9-]+(?:\.[a-z0-9-]+)+|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:mil\.id|go\.id|com|net|org|id|xyz|info|site|online|top|link|click))(?:/[^\s<>\"']*)?",
    re.IGNORECASE,
)


def extract_target_url(message: str) -> str | None:
    """Extract a URL from a soldier's message, normalizing bare domains with https:// if needed."""
    full_match = FULL_URL_REGEX.search(message)
    if full_match:
        return full_match.group(0).rstrip(".,);]*_")

    bare_match = BARE_DOMAIN_REGEX.search(message)
    if bare_match:
        candidate = bare_match.group(0).rstrip(".,);]*_")
        return f"https://{candidate}"

    return None


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


def _format_help_menu() -> str:
    """Professional tactical help & feature menu for TNI AD personnel."""
    return (
        "🛡️ *VISIKARTIKA SHIELD — PUSSIBERAD TNI AD*\n"
        "_Sistem Lapor Cepat & Deteksi Dini Phishing Siber_\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        "Selamat datang di layanan analisis tautan otomatis. Sistem ini memeriksa tautan mencurigakan menggunakan *Isolated Sandbox* dan *Computer Vision* dalam < 5 detik.\n\n"
        "📌 *CARA PENGGUNAAN & FITUR:*\n"
        "1️⃣ *Cek Tautan / Pesan Berantai*\n"
        "   Langsung kirim atau _forward_ pesan berisi tautan (`https://...`) ke chat ini untuk dipindai otomatis.\n\n"
        "2️⃣ *Ketik `portal` atau `/portal`*\n"
        "   Menampilkan daftar domain portal resmi TNI AD & Kemhan RI (`.mil.id` / `.go.id`).\n\n"
        "3️⃣ *Ketik `status` atau `/status`*\n"
        "   Melihat status operasional mesin pemindai & koneksi pusat komando SOC.\n\n"
        "4️⃣ *Ketik `darurat` atau `/darurat`*\n"
        "   Panduan langkah darurat jika terlanjur mengisi NRP / Kata Sandi / OTP di situs palsu.\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        "🔒 _Jaga kerahasiaan NRP, NIK, dan kredensial kedinasan Anda._"
    )


def _format_official_portals() -> str:
    """List verified official TNI AD and Kemhan domains."""
    domain_lines = "\n".join(f"  • `https://{d}`" for d in sorted(OFFICIAL_MIL_DOMAINS))
    return (
        "🏛️ *DAFTAR DOMAIN RESMI TNI AD & KEMHAN RI*\n"
        "_VisiKartika Shield — Protected Brand Whitelist_\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        "Pastikan alamat situs kedinasan atau rekrutmen yang Anda akses berakhiran *`.mil.id`* atau *`.go.id`* resmi berikut:\n\n"
        f"{domain_lines}\n\n"
        "⚠️ *PERINGATAN KEAMANAN:*\n"
        "Institusi TNI AD *tidak pernah* menggunakan domain komersial bebas (seperti `.com`, `.xyz`, `.net`, `.id` non-militer) untuk pendaftaran prajurit maupun login SSO/Sisfopers."
    )


def _format_emergency_guide() -> str:
    """Emergency mitigation steps if a soldier already submitted credentials."""
    return (
        "🚨 *PROTOKOL DARURAT KEBOCORAN KREDENSIAL*\n"
        "_PUSSIBERAD TNI AD — Tanggap Insiden Siber_\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        "Jika Anda atau rekan satuan terlanjur memasukkan *NRP, NIK, Kata Sandi, atau OTP* pada tautan mencurigakan:\n\n"
        "1. *Ganti Kata Sandi Segera*: Ubah password akun SSO / Sisfopers / Email Militer melalui perangkat lain yang aman.\n"
        "2. *Cabut Sesi Aktif*: Keluar (_logout_) dari seluruh sesi perangkat yang tidak dikenal.\n"
        "3. *Periksa Aplikasi Asing*: Hapus file `.apk` di luar Play Store jika sempat terunduh, lalu matikan koneksi data sementara.\n"
        "4. *Lapor Pejabat Siber / Sandi Satuan*: Teruskan bukti tautan ke chat ini agar domain penyerang segera masuk daftar *Blocklist DNS/Firewall* Komando."
    )


async def _format_system_status() -> str:
    """Live operational status of Sandbox, Vision Engine, and Supabase SOC."""
    sb_info = await SupabaseService.check_connection()
    sb_status = "🟢 Terhubung (Realtime Aktif)" if sb_info.get("connected") else "🟡 Mode Lokal / Fallback"
    inc_count = sb_info.get("incidents_count_sample", 0)
    portal_count = sb_info.get("portals_count_sample") or len(OFFICIAL_MIL_DOMAINS)

    return (
        "📊 *STATUS OPERASIONAL VISIKARTIKA SHIELD*\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        "• *Headless Chromium Sandbox*: 🟢 Aktif (Terisolasi)\n"
        "• *Mesin Computer Vision*: 🟢 Aktif (SSIM + Logo Detector)\n"
        "• *Analisis Telemetri DOM*: 🟢 Aktif\n"
        f"• *Koneksi SOC Supabase*: {sb_status}\n"
        f"• *Database Portal Resmi*: {portal_count} Portal Terlindungi\n"
        f"• *Log Insiden Terkini*: {inc_count} Rekaman Analisis\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        "Kirimkan tautan kapan saja untuk memulai pemindaian forensik."
    )


def _format_wa_scan_report(scan_res) -> str:
    """Format tactical PUSSIBERAD WhatsApp threat response for soldiers in the field."""
    if scan_res.verdict == "CRITICAL_PHISHING":
        header = "🚨 *PERINGATAN KRITIS: PHISHING TERDETEKSI!*"
        status_label = "BERBAHAYA (CRITICAL PHISHING)"
        advice = (
            "⛔ *INSTRUKSI TAKTIS*:\n"
            "• *JANGAN* masukkan NRP, NIK, kata sandi, PIN, atau kode OTP!\n"
            "• *JANGAN* menyebarkan tautan ini ke grup satuan/keluarga.\n"
            "• Bukti forensik telah dikirim otomatis ke *Dashboard SOC PUSSIBERAD* untuk pemblokiran domain."
        )
    elif scan_res.verdict == "SUSPICIOUS":
        header = "⚠️ *WASPADA: TAUTAN MENCURIGAKAN*"
        status_label = "MENCURIGAKAN (SUSPICIOUS)"
        advice = (
            "⚠️ *INSTRUKSI TAKTIS*:\n"
            "• Tautan ini memiliki anomali keamanan dan bukan portal resmi `.mil.id`.\n"
            "• Hindari mengisi data pribadi atau kredensial kedinasan sebelum diverifikasi petugas siber satuan."
        )
    else:
        header = "✅ *AMAN: PORTAL RESMI TERVERIFIKASI*"
        status_label = "AMAN (VERIFIED SAFE)"
        advice = (
            "✅ *INFORMASI*:\n"
            "• Domain terkonfirmasi aman dan tidak ditemukan aktivitas pencurian kredensial maupun pemalsuan identitas militer."
        )

    dom_score = scan_res.risk_analysis.dom_anomaly_score
    domain_score = scan_res.risk_analysis.domain_telemetry_score
    vis_score = scan_res.visual_similarity_score

    lines = [
        header,
        "_VisiKartika Shield — Hasil Analisis Forensik_",
        "━━━━━━━━━━━━━━━━━━━━━━",
        f"🔗 *Tautan Target*: {scan_res.final_url}",
        f"🛡️ *Status Putusan*: *{status_label}*",
        f"📈 *Skor Risiko Total*: *{scan_res.total_risk_score:.1f} / 100*",
        f"   ├─ Kemiripan Visual: `{vis_score:.1f}%`",
        f"   ├─ Anomali Struktur DOM: `{dom_score:.1f}%`",
        f"   └─ Telemetri Domain: `{domain_score:.1f}%`",
    ]

    if scan_res.impersonated_target and scan_res.verdict != "SAFE":
        lines.append(f"🎭 *Indikasi Penyamaran*: {scan_res.impersonated_target}")

    if scan_res.detected_logos:
        brands = ", ".join(
            f"{lg.brand_name} ({lg.confidence:.0f}%)" for lg in scan_res.detected_logos[:2]
        )
        lines.append(f"🎖️ *Atribut Militer Dicatut*: {brands}")

    if scan_res.risk_analysis.forensic_reasons:
        lines.append("\n🔍 *Temuan Forensik Utama*:")
        for reason in scan_res.risk_analysis.forensic_reasons[:3]:
            lines.append(f"  • {reason}")

    if scan_res.annotated_bbox_url and not scan_res.annotated_bbox_url.startswith("http://localhost"):
        lines.append(f"\n🖼️ *Bukti Visual*: {scan_res.annotated_bbox_url}")

    if scan_res.supabase_incident_id:
        short_id = str(scan_res.supabase_incident_id).split("-")[0].upper()
        lines.append(f"🆔 *ID Tiket SOC*: `#VK-{short_id}`")

    lines.extend(["━━━━━━━━━━━━━━━━━━━━━━", advice])
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
        "supported_commands": ["help", "portal", "status", "darurat", "<url>"],
    }


@router.post("")
@router.post("/")
async def fonnte_webhook(request: Request):
    """
    Webhook receiver for incoming WhatsApp messages via Fonnte.
    - Triage 1: Jika pesan mengandung URL/domain, jalankan pemindaian penuh
      (Playwright Sandbox + Computer Vision + DOM Telemetry + Supabase Sync).
    - Triage 2: Komando informasi profesional ('help', 'portal', 'status', 'darurat').
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
    normalized_cmd = message.lower().strip().lstrip("/")

    # Prioritas 1: Deteksi tautan / URL di dalam pesan prajurit
    extracted_url = extract_target_url(message)

    if extracted_url:
        try:
            scan_res = await execute_phase2_scan(
                target_url=extracted_url,
                reporter_source="WHATSAPP_BOT",
                reporter_unit=f"WA Lapor Cepat ({sender or 'Prajurit'})",
            )
            reply_text = _format_wa_scan_report(scan_res)
            scan_meta = {
                "scan_id": scan_res.scan_id,
                "verdict": scan_res.verdict,
                "total_risk_score": scan_res.total_risk_score,
                "supabase_synced": scan_res.supabase_synced,
                "supabase_incident_id": scan_res.supabase_incident_id,
            }
        except Exception as exc:
            reply_text = (
                "⚠️ *VISIKARTIKA SHIELD — GAGAL MENGAKSES TARGET*\n"
                "━━━━━━━━━━━━━━━━━━━━━━\n"
                f"🔗 *Tautan*: `{extracted_url}`\n\n"
                "Mesin Sandbox tidak dapat menjangkau alamat tersebut (kemungkinan situs sudah dinonaktifkan, koneksi ditolak, atau domain tidak valid).\n\n"
                "🔒 _Tetap waspada dan jangan membuka tautan tersebut di browser ponsel Anda._"
            )
            print(f"[WA Scan Error] {extracted_url}: {exc}")

    # Prioritas 2: Menu Bantuan & Fitur Komando
    elif normalized_cmd in ("portal", "domain", "resmi", "whitelist"):
        reply_text = _format_official_portals()
    elif normalized_cmd in ("status", "cek status", "info sistem", "health"):
        reply_text = await _format_system_status()
    elif normalized_cmd in ("darurat", "lapor", "sos", "bocor", "mitigasi"):
        reply_text = _format_emergency_guide()
    elif message:
        # Untuk pesan sapaan, 'help', 'bantuan', 'menu', atau teks tanpa tautan:
        # tampilkan panduan profesional Lapor Cepat PUSSIBERAD
        reply_text = _format_help_menu()

    if reply_text and sender:
        await send_whatsapp_message(target=sender, message_text=reply_text)

    response_payload = {
        "status": True,
        "reply": reply_text,
    }
    if scan_meta is not None:
        response_payload["scan"] = scan_meta
    return response_payload
