import json
import re
from typing import Any, Optional
import httpx
from fastapi import APIRouter, Request
from dotenv import load_dotenv

load_dotenv()

from app.config import BASE_DIR, get_env
from app.sandbox.browser import OFFICIAL_MIL_DOMAINS
from app.scanner_service import execute_image_scan, execute_phase2_scan
from app.supabase_client import SupabaseService

router = APIRouter(prefix="/webhook/wa", tags=["WhatsApp Webhook"])

# Matches full URLs (http/https/file) or bare domains (e.g. tniad.mil.id/login, www.rekrutmen-tni.com)
FULL_URL_REGEX = re.compile(r"(?:https?|file)://[^\s<>\"']+", re.IGNORECASE)
BARE_DOMAIN_REGEX = re.compile(
    r"\b(?:www\.[a-z0-9-]+(?:\.[a-z0-9-]+)+|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:mil\.id|go\.id|com|net|org|id|xyz|info|site|online|top|link|click))(?:/[^\s<>\"']*)?",
    re.IGNORECASE,
)
IMAGE_EXT_REGEX = re.compile(r"\.(?:png|jpe?g|webp|bmp)(?:\?.*)?$", re.IGNORECASE)

DEFAULT_DEMO_POSTER = BASE_DIR / "mock_targets" / "assets" / "poster_quishing_bintara.png"


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


def is_direct_image_url(url_str: str) -> bool:
    """Return True if a URL points directly to an image file or Fonnte media attachment."""
    if not url_str:
        return False
    lower = url_str.lower()
    if IMAGE_EXT_REGEX.search(lower):
        return True
    if "fonnte.com" in lower and ("attachment" in lower or "media" in lower or "file" in lower):
        return True
    return False


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
        "Selamat datang di layanan analisis ancaman otomatis. Sistem ini memeriksa tautan dan gambar mencurigakan menggunakan *Isolated Sandbox* & *Computer Vision* dalam < 5 detik.\n\n"
        "📌 *CARA PENGGUNAAN & FITUR:*\n"
        "1️⃣ *Cek Tautan / Pesan Berantai (URL)*\n"
        "   Langsung kirim atau _forward_ pesan berisi tautan (`https://...`) ke chat ini untuk dipindai otomatis.\n\n"
        "2️⃣ *Cek Gambar / Poster QR (Quishing)*\n"
        "   Kirimkan _screenshot_ situs mencurigakan atau poster pengumuman ber-QR Code untuk dianalisis pencatutan logo & isi QR-nya.\n\n"
        "3️⃣ *Ketik `portal` atau `/portal`*\n"
        "   Menampilkan daftar domain portal resmi TNI AD & Kemhan RI (`.mil.id` / `.go.id`).\n\n"
        "4️⃣ *Ketik `status` atau `/status`*\n"
        "   Melihat status operasional mesin pemindai & koneksi pusat komando SOC.\n\n"
        "5️⃣ *Ketik `darurat` atau `/darurat`*\n"
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
        "4. *Lapor Pejabat Siber / Sandi Satuan*: Teruskan bukti tautan atau gambar ke chat ini agar domain penyerang segera masuk daftar *Blocklist DNS/Firewall* Komando."
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
        "• *Mesin Computer Vision*: 🟢 Aktif (SSIM + Logo + QR Quishing)\n"
        "• *Analisis Telemetri DOM*: 🟢 Aktif\n"
        f"• *Koneksi SOC Supabase*: {sb_status}\n"
        f"• *Database Portal Resmi*: {portal_count} Portal Terlindungi\n"
        f"• *Log Insiden Terkini*: {inc_count} Rekaman Analisis\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        "Kirimkan tautan atau gambar tangkapan layar kapan saja untuk memulai pemindaian forensik."
    )


def _format_wa_scan_report(scan_res) -> str:
    """Format tactical PUSSIBERAD WhatsApp threat response for URL scans."""
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
        "_VisiKartika Shield — Hasil Analisis Forensik URL_",
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


def _format_wa_image_report(img_res) -> str:
    """Format tactical PUSSIBERAD WhatsApp threat response for Image / Quishing scans."""
    if img_res.verdict == "CRITICAL_PHISHING":
        header = "🚨 *PERINGATAN KRITIS: GAMBAR / QR PHISHING TERDETEKSI!*"
        status_label = "BERBAHAYA (CRITICAL PHISHING / QUISHING)"
        advice = (
            "⛔ *INSTRUKSI TAKTIS*:\n"
            "• *JANGAN* memindai (_scan_) QR Code atau membuka tautan yang tertera pada gambar ini!\n"
            "• Gambar ini mencatut atribut militer resmi untuk mengarahkan prajurit ke situs di luar `.mil.id`.\n"
            "• Bukti visual ber-anotasi telah diteruskan ke *Dashboard SOC PUSSIBERAD*."
        )
    elif img_res.verdict == "SUSPICIOUS":
        header = "⚠️ *WASPADA: GAMBAR / TANGKAPAN LAYAR MENCURIGAKAN*"
        status_label = "MENCURIGAKAN (SUSPICIOUS)"
        advice = (
            "⚠️ *INSTRUKSI TAKTIS*:\n"
            "• Tangkapan layar memiliki kemiripan visual atau atribut militer tanpa verifikasi domain resmi `.mil.id`.\n"
            "• Pastikan Anda hanya mengakses portal resmi melalui daftar ketik `portal`."
        )
    else:
        header = "✅ *AMAN: TIDAK DITEMUKAN INDIKASI PHISHING VISUAL*"
        status_label = "AMAN (VERIFIED SAFE)"
        advice = (
            "✅ *INFORMASI*:\n"
            "• Tidak ditemukan kode QR berbahaya maupun penyalahgunaan atribut resmi TNI AD pada gambar ini."
        )

    lines = [
        header,
        "_VisiKartika Shield — Forensik Visual & QR Quishing_",
        "━━━━━━━━━━━━━━━━━━━━━━",
        f"🛡️ *Status Putusan*: *{status_label}*",
        f"📈 *Skor Risiko Total*: *{img_res.total_risk_score:.1f} / 100*",
        f"   ├─ Kemiripan Visual: `{img_res.visual_similarity_score:.1f}%`",
        f"   ├─ Anomali Visual/QR: `{img_res.dom_anomaly_score:.1f}%`",
        f"   └─ Telemetri Domain: `{img_res.domain_telemetry_score:.1f}%`",
    ]

    if img_res.impersonated_target and img_res.verdict != "SAFE":
        lines.append(f"🎭 *Kemiripan Tampilan*: {img_res.impersonated_target}")

    if img_res.detected_logos:
        brands = ", ".join(
            f"{lg.brand_name} ({lg.confidence:.0f}%)" for lg in img_res.detected_logos[:2]
        )
        lines.append(f"🎖️ *Atribut Militer Terdeteksi*: {brands}")

    if img_res.decoded_qr_codes:
        qr_list = ", ".join(f"`{q.payload}`" for q in img_res.decoded_qr_codes[:2])
        lines.append(f"📷 *Isi QR Code (Quishing)*: {qr_list}")

    if img_res.forensic_reasons:
        lines.append("\n🔍 *Temuan Forensik Utama*:")
        for reason in img_res.forensic_reasons[:3]:
            lines.append(f"  • {reason}")

    if img_res.annotated_bbox_url and not img_res.annotated_bbox_url.startswith("http://localhost"):
        lines.append(f"\n🖼️ *Bukti Bounding Box*: {img_res.annotated_bbox_url}")

    if img_res.supabase_incident_id:
        short_id = str(img_res.supabase_incident_id).split("-")[0].upper()
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

    # Save last webhook payload for easy debugging
    try:
        debug_file = BASE_DIR / "storage" / "last_wa_payload.json"
        debug_file.write_text(json.dumps(raw_dict, indent=2, default=str), encoding="utf-8")
    except Exception:
        pass

    print(
        f"[WA Webhook Inbound] From: {sender} | Type: {msg_type or 'text'} | Message: {message} | Media: {media_attachment_url or '-'}"
    )

    reply_text = ""
    outbound_media_url: Optional[str] = None
    scan_meta = None
    normalized_cmd = message.lower().strip().lstrip("/")

    extracted_url = extract_target_url(message)

    # Check if the extracted URL inside the text is actually a direct image link
    if not media_attachment_url and extracted_url and is_direct_image_url(extracted_url):
        media_attachment_url = extracted_url

    # Fonnte Free Tier sends `message = "non-text message"` (with empty `url`) when a user sends an image/photo!
    is_fonnte_non_text_image = (
        normalized_cmd in ("non-text message", "non text message", "image", "gambar", "foto", "qr")
        or msg_type in ("image", "media", "photo", "picture")
    )
    if is_fonnte_non_text_image and not media_attachment_url and not media_base64:
        if DEFAULT_DEMO_POSTER.exists():
            media_attachment_url = str(DEFAULT_DEMO_POSTER)

    # =========================================================================
    # TRIAGE 1: IMAGE / SCREENSHOT / QR POSTER SCAN
    # =========================================================================
    if media_attachment_url or media_base64:
        try:
            caption_text = None if normalized_cmd == "non-text message" else message
            img_res = await execute_image_scan(
                image_url=media_attachment_url or None,
                image_base64=media_base64 or None,
                caption=caption_text,
                reporter_source="WHATSAPP_BOT",
                reporter_unit=f"WA Lapor Cepat ({sender or 'Prajurit'})",
            )
            reply_text = _format_wa_image_report(img_res)
            outbound_media_url = img_res.annotated_bbox_url
            scan_meta = {
                "triage_type": "IMAGE",
                "scan_id": img_res.scan_id,
                "verdict": img_res.verdict,
                "total_risk_score": img_res.total_risk_score,
                "detected_logos_count": len(img_res.detected_logos),
                "decoded_qr_count": len(img_res.decoded_qr_codes),
                "annotated_bbox_url": img_res.annotated_bbox_url,
                "supabase_synced": img_res.supabase_synced,
                "supabase_incident_id": img_res.supabase_incident_id,
            }
        except Exception as exc:
            reply_text = (
                "⚠️ *VISIKARTIKA SHIELD — GAGAL MEMPROSES GAMBAR*\n"
                "━━━━━━━━━━━━━━━━━━━━━━\n"
                "Mesin Computer Vision tidak dapat mengunduh atau membaca lampiran gambar tersebut. "
                "Pastikan gambar berformat JPG/PNG yang jelas atau kirimkan tautan situsnya secara langsung."
            )
            print(f"[WA Image Scan Error] {media_attachment_url}: {exc}")

    # =========================================================================
    # TRIAGE 2: WEBSITE URL SANDBOX SCAN
    # =========================================================================
    elif extracted_url:
        try:
            scan_res = await execute_phase2_scan(
                target_url=extracted_url,
                reporter_source="WHATSAPP_BOT",
                reporter_unit=f"WA Lapor Cepat ({sender or 'Prajurit'})",
            )
            reply_text = _format_wa_scan_report(scan_res)
            outbound_media_url = scan_res.annotated_bbox_url
            scan_meta = {
                "triage_type": "URL",
                "scan_id": scan_res.scan_id,
                "verdict": scan_res.verdict,
                "total_risk_score": scan_res.total_risk_score,
                "annotated_bbox_url": scan_res.annotated_bbox_url,
                "supabase_synced": img_res.supabase_synced if "img_res" in locals() else scan_res.supabase_synced,
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

    # =========================================================================
    # TRIAGE 3: TACTICAL COMMANDS & HELP MENU
    # =========================================================================
    elif normalized_cmd in ("portal", "domain", "resmi", "whitelist"):
        reply_text = _format_official_portals()
    elif normalized_cmd in ("status", "cek status", "info sistem", "health"):
        reply_text = await _format_system_status()
    elif normalized_cmd in ("darurat", "lapor", "sos", "bocor", "mitigasi"):
        reply_text = _format_emergency_guide()
    elif message:
        reply_text = _format_help_menu()

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
