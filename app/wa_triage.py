"""
VisiKartika Shield - WhatsApp Message Triage Router (Phase 2+).

Transport-agnostic triage shared by every WhatsApp gateway (OpenWA/Baileys now,
Fonnte kept as legacy):

    InboundMessage ──► classify ──► IMAGE   → execute_image_scan   (logo + QR + OCR + layout)
                                ├─► URL     → execute_phase2_scan   (sandbox + DOM + visual)
                                ├─► COMMAND → portal / status / darurat / help
                                └─► IGNORED (empty / unsupported)

Gateways only translate their webhook payload into `InboundMessage` and send
`TriageResult.reply_text` (+ optional `evidence_image_path`) back.

Security: message content comes from ANY WhatsApp user, so URL targets are
restricted to http/https and loopback/private hosts are refused (except the
built-in `/mock-targets/` demo pages). `file://` and local paths are never
accepted from chat input (prevents local-file disclosure through screenshots).
"""

from __future__ import annotations

import asyncio
import ipaddress
import re
import socket
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional
from urllib.parse import urlparse

from app.config import BASE_DIR
from app.domain_guard import OFFICIAL_MIL_DOMAINS
from app.supabase_client import SupabaseService

# --------------------------------------------------------------------------- #
# Message parsing
# --------------------------------------------------------------------------- #
FULL_URL_REGEX = re.compile(r"https?://[^\s<>\"']+", re.IGNORECASE)
BARE_DOMAIN_REGEX = re.compile(
    r"\b(?:www\.[a-z0-9-]+(?:\.[a-z0-9-]+)+|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:mil\.id|go\.id|ac\.id|co\.id|com|net|org|id|xyz|info|site|online|top|link|click|me|io|app|biz|live|shop|vip|cc))(?:/[^\s<>\"']*)?",
    re.IGNORECASE,
)
IMAGE_EXT_REGEX = re.compile(r"\.(?:png|jpe?g|webp|bmp)(?:\?.*)?$", re.IGNORECASE)
_TRAILING_PUNCT = ".,);]*_!?'\""

CMD_PORTAL = ("portal", "domain", "resmi", "whitelist")
CMD_STATUS = ("status", "cek status", "info sistem", "health")
CMD_EMERGENCY = ("darurat", "lapor", "sos", "bocor", "mitigasi")
CMD_HELP = ("help", "bantuan", "menu", "start", "halo", "hai", "ping")

MOCK_TARGET_PREFIX = "/mock-targets/"


def extract_target_url(message: str) -> Optional[str]:
    """Extract the first http(s) URL or bare domain from a message (bare → https://)."""
    if not message:
        return None
    full_match = FULL_URL_REGEX.search(message)
    if full_match:
        return full_match.group(0).rstrip(_TRAILING_PUNCT)

    bare_match = BARE_DOMAIN_REGEX.search(message)
    if bare_match:
        return f"https://{bare_match.group(0).rstrip(_TRAILING_PUNCT)}"
    return None


def is_direct_image_url(url_str: str) -> bool:
    """True if a URL points directly to an image file (or a Fonnte media attachment)."""
    if not url_str:
        return False
    lower = url_str.lower()
    if IMAGE_EXT_REGEX.search(urlparse(lower).path or lower):
        return True
    return "fonnte.com" in lower and any(k in lower for k in ("attachment", "media", "file"))


def _host_is_private(host: str) -> bool:
    """True for loopback / private / link-local / reserved hosts (resolves DNS names)."""
    if not host:
        return True
    if host in ("localhost", "localhost.localdomain") or host.endswith(".localhost") or host.endswith(".local"):
        return True
    candidates: list[str] = []
    try:
        ipaddress.ip_address(host.strip("[]"))
        candidates = [host.strip("[]")]
    except ValueError:
        try:
            candidates = list({info[4][0] for info in socket.getaddrinfo(host, None)})
        except (socket.gaierror, UnicodeError, OSError):
            return False  # unresolvable → let the sandbox report it as unreachable
    for ip_str in candidates:
        try:
            ip = ipaddress.ip_address(ip_str.split("%", 1)[0])
        except ValueError:
            continue
        if ip.is_loopback or ip.is_private or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            return True
    return False


def validate_chat_target_url(url: str) -> tuple[bool, str]:
    """
    Validate a URL received from chat before sending it to the sandbox.
    Returns `(allowed, reason_if_refused)`.
    """
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return False, "Hanya tautan http/https yang dapat dipindai."
    host = (parsed.hostname or "").lower()
    if not host:
        return False, "Tautan tidak memiliki nama domain yang valid."
    if _host_is_private(host):
        if (parsed.path or "").startswith(MOCK_TARGET_PREFIX):
            return True, ""  # built-in legal demo pages served by this backend
        return False, "Alamat jaringan internal/privat tidak diizinkan untuk dipindai dari WhatsApp."
    return True, ""


# --------------------------------------------------------------------------- #
# Data contracts
# --------------------------------------------------------------------------- #
@dataclass
class InboundMessage:
    channel: str                      # "OPENWA" | "FONNTE" | "TEST"
    sender: str                       # display id of the reporter (phone / lid)
    text: str = ""
    media_bytes: Optional[bytes] = None
    media_mimetype: Optional[str] = None
    media_url: Optional[str] = None   # remote http(s) image URL (never a local path)
    has_unreadable_media: bool = False  # media present but bytes not retrievable
    trusted_local_image: Optional[Path] = None  # server-chosen file (legacy demo fallback only)


@dataclass
class TriageResult:
    kind: str                         # IMAGE | URL | COMMAND | HELP | REFUSED | ERROR | IGNORED
    reply_text: str = ""
    evidence_image_path: Optional[Path] = None
    evidence_image_url: Optional[str] = None
    scan_meta: Optional[dict[str, Any]] = None
    target: Optional[str] = None
    ack_text: Optional[str] = None    # short "scanning…" notice gateways may send first


def classify_message(msg: InboundMessage) -> tuple[str, Optional[str]]:
    """Decide the triage lane. Returns `(kind, url_or_none)` without side effects."""
    text = (msg.text or "").strip()
    url = extract_target_url(text)

    if msg.media_bytes or msg.trusted_local_image:
        return "IMAGE", None
    if msg.media_url:
        return "IMAGE", msg.media_url
    if url and is_direct_image_url(url):
        return "IMAGE", url
    if msg.has_unreadable_media:
        return "MEDIA_UNREADABLE", None
    if url:
        return "URL", url

    cmd = text.lower().lstrip("/").strip()
    if cmd in CMD_PORTAL or cmd in CMD_STATUS or cmd in CMD_EMERGENCY:
        return "COMMAND", None
    if text:
        return "HELP", None
    return "IGNORED", None


# --------------------------------------------------------------------------- #
# Reply formatters (Bahasa Indonesia, WhatsApp markdown)
# --------------------------------------------------------------------------- #
SEP = "━━━━━━━━━━━━━━━━━━━━━━"


def format_help_menu() -> str:
    return (
        "🛡️ *VISIKARTIKA SHIELD — PUSSIBERAD TNI AD*\n"
        "_Sistem Lapor Cepat & Deteksi Dini Phishing Siber_\n"
        f"{SEP}\n"
        "Selamat datang di layanan analisis ancaman otomatis. Sistem ini memeriksa tautan, poster pengumuman, dan tangkapan layar menggunakan *Isolated Sandbox*, *Computer Vision*, & *OCR*.\n\n"
        "📌 *CARA PENGGUNAAN & FITUR:*\n"
        "1️⃣ *Cek Tautan / Pesan Berantai (URL)*\n"
        "   Langsung kirim atau _forward_ pesan berisi tautan (`https://...`) ke chat ini untuk dipindai otomatis.\n\n"
        "2️⃣ *Cek Poster / Screenshot Web / QR (Quishing)*\n"
        "   Kirimkan poster rekrutmen, _screenshot_ situs web, atau gambar ber-QR Code untuk dianalisis keasliannya.\n\n"
        "3️⃣ *Ketik `portal` atau `/portal`*\n"
        "   Menampilkan daftar domain portal resmi TNI AD & Kemhan RI (`.mil.id` / `.go.id`).\n\n"
        "4️⃣ *Ketik `status` atau `/status`*\n"
        "   Melihat status operasional mesin pemindai & koneksi pusat komando SOC.\n\n"
        "5️⃣ *Ketik `darurat` atau `/darurat`*\n"
        "   Panduan langkah darurat jika terlanjur mengisi NRP / Kata Sandi / OTP di situs palsu.\n"
        f"{SEP}\n"
        "🔒 _Jaga kerahasiaan NRP, NIK, dan kredensial kedinasan Anda._"
    )


def format_official_portals() -> str:
    domain_lines = "\n".join(f"  • `https://{d}`" for d in sorted(OFFICIAL_MIL_DOMAINS))
    return (
        "🏛️ *DAFTAR DOMAIN RESMI TNI AD & KEMHAN RI*\n"
        "_VisiKartika Shield — Protected Brand Whitelist_\n"
        f"{SEP}\n"
        "Pastikan alamat situs kedinasan atau rekrutmen yang Anda akses berakhiran *`.mil.id`* atau *`.go.id`* resmi berikut:\n\n"
        f"{domain_lines}\n\n"
        "⚠️ *PERINGATAN KEAMANAN:*\n"
        "Institusi TNI AD *tidak pernah* memungut biaya rekrutmen dan *tidak pernah* menggunakan domain komersial bebas (`.com`, `.xyz`, `.net`, `.id` non-militer) untuk login SSO/Sisfopers."
    )


def format_emergency_guide() -> str:
    return (
        "🚨 *PROTOKOL DARURAT KEBOCORAN KREDENSIAL*\n"
        "_PUSSIBERAD TNI AD — Tanggap Insiden Siber_\n"
        f"{SEP}\n"
        "Jika Anda atau rekan satuan terlanjur memasukkan *NRP, NIK, Kata Sandi, atau OTP* pada tautan mencurigakan:\n\n"
        "1. *Ganti Kata Sandi Segera*: Ubah password akun SSO / Sisfopers / Email Militer melalui perangkat lain yang aman.\n"
        "2. *Cabut Sesi Aktif*: Keluar (_logout_) dari seluruh sesi perangkat yang tidak dikenal.\n"
        "3. *Periksa Aplikasi Asing*: Hapus file `.apk` di luar Play Store jika sempat terunduh, lalu matikan koneksi data sementara.\n"
        "4. *Lapor Pejabat Siber / Sandi Satuan*: Teruskan bukti tautan atau gambar ke chat ini agar domain penyerang segera masuk daftar *Blocklist DNS/Firewall* Komando."
    )


async def format_system_status() -> str:
    sb_info = await SupabaseService.check_connection()
    sb_status = "🟢 Terhubung (Realtime Aktif)" if sb_info.get("connected") else "🟡 Mode Lokal / Fallback"
    inc_count = sb_info.get("incidents_count_sample", 0)
    portal_count = sb_info.get("portals_count_sample") or len(OFFICIAL_MIL_DOMAINS)
    return (
        "📊 *STATUS OPERASIONAL VISIKARTIKA SHIELD*\n"
        f"{SEP}\n"
        "• *Headless Chromium Sandbox*: 🟢 Aktif (Terisolasi)\n"
        "• *Mesin Vision + OCR Poster*: 🟢 Aktif (SSIM + Logo + QR + OCR)\n"
        "• *Analisis Telemetri DOM*: 🟢 Aktif\n"
        f"• *Koneksi SOC Supabase*: {sb_status}\n"
        f"• *Database Portal Resmi*: {portal_count} Portal Terlindungi\n"
        f"• *Log Insiden Terkini*: {inc_count} Rekaman Analisis\n"
        f"{SEP}\n"
        "Kirimkan tautan, poster, atau tangkapan layar kapan saja untuk memulai pemindaian forensik."
    )


def _verdict_block(verdict: str, kind: str, content_category: str = "UNKNOWN") -> tuple[str, str, str]:
    if verdict == "CRITICAL_PHISHING":
        if kind == "IMAGE":
            if content_category == "GENERIC_PHISHING":
                return (
                    "🚨 *PERINGATAN KRITIS: GAMBAR / POSTER PENIPUAN SIBER TERDETEKSI!*",
                    "BERBAHAYA (CRITICAL PHISHING / SCAM)",
                    "⛔ *INSTRUKSI TAKTIS*:\n"
                    "• *JANGAN* memindai QR Code, mengunduh file `.apk`, atau mengisi PIN/OTP/kata sandi!\n"
                    "• Gambar ini mengandung tautan atau pola penipuan siber berisiko tinggi.\n"
                    "• Bukti visual ber-anotasi telah diteruskan ke *Dashboard SOC PUSSIBERAD*.",
                )
            return (
                "🚨 *PERINGATAN KRITIS: POSTER / GAMBAR PHISHING MILITER TERDETEKSI!*",
                "BERBAHAYA (CRITICAL PHISHING / QUISHING)",
                "⛔ *INSTRUKSI TAKTIS*:\n"
                "• *JANGAN* memindai (_scan_) QR Code, menghubungi nomor calo, atau membuka tautan pada gambar ini!\n"
                "• Gambar ini mencatut atribut militer resmi untuk penipuan/pencurian data di luar `.mil.id`.\n"
                "• Bukti visual ber-anotasi telah diteruskan ke *Dashboard SOC PUSSIBERAD*.",
            )
        if content_category == "GENERIC_PHISHING":
            return (
                "🚨 *PERINGATAN KRITIS: SITUS PHISHING BERBAHAYA TERDETEKSI!*",
                "BERBAHAYA (CRITICAL PHISHING)",
                "⛔ *INSTRUKSI TAKTIS*:\n"
                "• *JANGAN* masukkan kata sandi, PIN, kode OTP, atau data pribadi pada tautan ini!\n"
                "• Tautan menggunakan infrastruktur mencurigakan yang berpotensi mencuri kredensial Anda.",
            )
        return (
            "🚨 *PERINGATAN KRITIS: PHISHING TERDETEKSI!*",
            "BERBAHAYA (CRITICAL PHISHING)",
            "⛔ *INSTRUKSI TAKTIS*:\n"
            "• *JANGAN* masukkan NRP, NIK, kata sandi, PIN, atau kode OTP!\n"
            "• *JANGAN* menyebarkan tautan ini ke grup satuan/keluarga.\n"
            "• Bukti forensik telah dikirim otomatis ke *Dashboard SOC PUSSIBERAD* untuk pemblokiran domain.",
        )
    if verdict == "SUSPICIOUS":
        if kind == "IMAGE":
            return (
                "⚠️ *WASPADA: GAMBAR / POSTER MENCURIGAKAN*",
                "MENCURIGAKAN (SUSPICIOUS)",
                "⚠️ *INSTRUKSI TAKTIS*:\n"
                "• Gambar memiliki indikator anomali atau atribut tanpa verifikasi domain resmi `.mil.id`.\n"
                "• Pastikan Anda hanya mengakses portal resmi melalui daftar ketik `portal`.",
            )
        return (
            "⚠️ *WASPADA: TAUTAN MENCURIGAKAN*",
            "MENCURIGAKAN (SUSPICIOUS)",
            "⚠️ *INSTRUKSI TAKTIS*:\n"
            "• Tautan ini memiliki anomali keamanan dan bukan portal resmi `.mil.id`.\n"
            "• Hindari mengisi data pribadi atau kredensial kedinasan sebelum diverifikasi petugas siber satuan.",
        )
    if kind == "IMAGE":
        if content_category in ("OFFICIAL_MILITARY", "POSTER_OFFICIAL_MILITARY"):
            return (
                "✅ *AMAN: PUBLIKASI / ATRIBUT MILITER RESMI*",
                "AMAN (VERIFIED SAFE — KONTEN MILITER)",
                "✅ *INFORMASI*:\n"
                "• Konten memuat atribut/informasi resmi tanpa tautan phishing, QR palsu, maupun indikasi pungutan calo.",
            )
        return (
            "✅ *AMAN: GAMBAR / SCREENSHOT UMUM (BUKAN PHISHING & BUKAN TNI)*",
            "AMAN (VERIFIED SAFE — KONTEN UMUM NON-TNI)",
            "✅ *INFORMASI*:\n"
            "• Gambar ini merupakan tangkapan layar web atau poster umum non-militer dan tidak mengandung indikasi phishing maupun penyalahgunaan atribut TNI AD.",
        )
    if content_category == "OFFICIAL_MILITARY":
        return (
            "✅ *AMAN: PORTAL RESMI TERVERIFIKASI*",
            "AMAN (VERIFIED SAFE — PORTAL RESMI .MIL.ID)",
            "✅ *INFORMASI*:\n"
            "• Domain terkonfirmasi sebagai portal resmi dalam daftar putih (*Whitelist*) TNI AD / Kemhan RI.",
        )
    return (
        "✅ *AMAN: SITUS WEB UMUM NON-MILITER (BUKAN PHISHING)*",
        "AMAN (VERIFIED SAFE — SITUS UMUM NON-TNI)",
        "✅ *INFORMASI*:\n"
        "• Situs ini bukan portal kedinasan TNI AD, namun terkonfirmasi aman dan tidak ditemukan pencurian kredensial maupun pemalsuan identitas militer.\n"
        "• Gunakan kredensial kedinasan (NRP/Sisfopers) *hanya* pada domain resmi `.mil.id`.",
    )


def _is_public_evidence_url(url: Optional[str]) -> bool:
    return bool(url) and not str(url).startswith(("http://localhost", "http://127.0.0.1"))


def _ticket_line(incident_id: Optional[str]) -> Optional[str]:
    if not incident_id:
        return None
    return f"🆔 *ID Tiket SOC*: `#VK-{str(incident_id).split('-')[0].upper()}`"


def format_url_report(scan_res, include_evidence_link: bool = True) -> str:
    is_off = bool(getattr(getattr(scan_res, "risk_analysis", None), "is_official_mil_domain", False))
    cat = getattr(scan_res, "content_category", "") or ("OFFICIAL_MILITARY" if is_off else "UNKNOWN")
    header, status_label, advice = _verdict_block(scan_res.verdict, "URL", cat)
    lines = [
        header,
        "_VisiKartika Shield — Hasil Analisis Forensik URL_",
        SEP,
        f"🔗 *Tautan Target*: {scan_res.final_url}",
        f"🛡️ *Status Putusan*: *{status_label}*",
        f"📈 *Skor Risiko Total*: *{scan_res.total_risk_score:.1f} / 100*",
        f"   ├─ Kemiripan Visual: `{scan_res.visual_similarity_score:.1f}%`",
        f"   ├─ Anomali Struktur DOM: `{scan_res.risk_analysis.dom_anomaly_score:.1f}%`",
        f"   └─ Telemetri Domain: `{scan_res.risk_analysis.domain_telemetry_score:.1f}%`",
    ]
    if scan_res.impersonated_target and scan_res.verdict != "SAFE":
        lines.append(f"🎭 *Indikasi Penyamaran*: {scan_res.impersonated_target}")
    if scan_res.detected_logos:
        brands = ", ".join(f"{lg.brand_name} ({lg.confidence:.0f}%)" for lg in scan_res.detected_logos[:2])
        lines.append(f"🎖️ *Atribut Militer Terdeteksi*: {brands}")
    if scan_res.risk_analysis.forensic_reasons:
        lines.append("\n🔍 *Temuan Forensik Utama*:")
        lines.extend(f"  • {r}" for r in scan_res.risk_analysis.forensic_reasons[:3])
    if include_evidence_link and _is_public_evidence_url(scan_res.annotated_bbox_url):
        lines.append(f"\n🖼️ *Bukti Visual*: {scan_res.annotated_bbox_url}")
    ticket = _ticket_line(scan_res.supabase_incident_id)
    if ticket:
        lines.append(ticket)
    lines.extend([SEP, advice])
    return "\n".join(lines)


def format_image_report(img_res, include_evidence_link: bool = True) -> str:
    cat = getattr(img_res, "content_category", "UNKNOWN") or "UNKNOWN"
    layout_type = getattr(img_res, "layout_type", "GENERAL_IMAGE")
    header, status_label, advice = _verdict_block(img_res.verdict, "IMAGE", cat)
    lines = [
        header,
        "_VisiKartika Shield — Forensik Poster, Screenshot & QR_",
        SEP,
        f"🛡️ *Status Putusan*: *{status_label}*",
        f"🗂️ *Jenis Konten*: `{layout_type}`",
        f"📈 *Skor Risiko Total*: *{img_res.total_risk_score:.1f} / 100*",
        f"   ├─ Kemiripan Visual: `{img_res.visual_similarity_score:.1f}%`",
        f"   ├─ Anomali Konten/OCR/QR: `{img_res.dom_anomaly_score:.1f}%`",
        f"   └─ Telemetri Domain: `{img_res.domain_telemetry_score:.1f}%`",
    ]
    if img_res.impersonated_target and img_res.verdict != "SAFE":
        lines.append(f"🎭 *Indikasi Penyamaran*: {img_res.impersonated_target}")
    if img_res.detected_logos:
        brands = ", ".join(f"{lg.brand_name} ({lg.confidence:.0f}%)" for lg in img_res.detected_logos[:2])
        lines.append(f"🎖️ *Atribut Militer Terdeteksi*: {brands}")
    if img_res.decoded_qr_codes:
        qr_list = ", ".join(f"`{q.payload}`" for q in img_res.decoded_qr_codes[:2])
        lines.append(f"📷 *Isi QR Code*: {qr_list}")
    elif img_res.extracted_urls:
        url_list = ", ".join(f"`{u}`" for u in img_res.extracted_urls[:2])
        lines.append(f"🔗 *Tautan Terbaca (OCR)*: {url_list}")
    if img_res.forensic_reasons:
        lines.append("\n🔍 *Temuan Forensik Utama*:")
        lines.extend(f"  • {r}" for r in img_res.forensic_reasons[:3])
    if include_evidence_link and _is_public_evidence_url(img_res.annotated_bbox_url):
        lines.append(f"\n🖼️ *Bukti Bounding Box*: {img_res.annotated_bbox_url}")
    ticket = _ticket_line(img_res.supabase_incident_id)
    if ticket:
        lines.append(ticket)
    lines.extend([SEP, advice])
    return "\n".join(lines)


def format_evidence_caption(verdict: str, score: float, kind: str) -> str:
    """Short caption (<1024 chars, WhatsApp media limit) for the annotated evidence image."""
    icon = {"CRITICAL_PHISHING": "🚨", "SUSPICIOUS": "⚠️"}.get(verdict, "✅")
    what = "poster/gambar" if kind == "IMAGE" else "halaman"
    return (
        f"{icon} *Bukti Forensik VisiKartika Shield*\n"
        f"Putusan: *{verdict}* — Skor {score:.1f}/100\n"
        f"Kotak merah = logo militer, kotak oranye/ungu = form kredensial / QR pada {what}."
    )


def format_refused(reason: str, url: str) -> str:
    return (
        "⛔ *VISIKARTIKA SHIELD — TAUTAN DITOLAK*\n"
        f"{SEP}\n"
        f"🔗 *Tautan*: `{url}`\n\n"
        f"{reason}\n\n"
        "Kirimkan tautan situs publik (https://…) atau tangkapan layarnya."
    )


def format_unreadable_media() -> str:
    return (
        "⚠️ *VISIKARTIKA SHIELD — LAMPIRAN TIDAK TERBACA*\n"
        f"{SEP}\n"
        "Lampiran diterima, tetapi bukan gambar yang dapat dianalisis (atau gagal diunduh dari gateway).\n"
        "Kirim ulang sebagai *foto* (JPG/PNG), atau kirimkan tautan situsnya secara langsung."
    )


# --------------------------------------------------------------------------- #
# Router
# --------------------------------------------------------------------------- #
async def process_inbound(
    msg: InboundMessage,
    on_scan_start: Optional[Callable[[str], Awaitable[Any]]] = None,
) -> TriageResult:
    """
    Run the full triage pipeline for one inbound WhatsApp message.
    `on_scan_start(kind)` is awaited right before a (multi-second) scan begins,
    after validation passed — gateways use it to send a "scanning…" notice.
    """
    # Imported lazily so this module can be unit-tested without Playwright/OpenCV state.
    from app.scanner_service import execute_image_scan, execute_phase2_scan

    kind, url = classify_message(msg)
    reporter_unit = f"WA {msg.channel.title()} ({msg.sender or 'Prajurit'})"

    if kind == "IMAGE":
        if url and not msg.media_bytes and not msg.trusted_local_image:
            allowed, reason = await asyncio.to_thread(validate_chat_target_url, url)
            if not allowed:
                return TriageResult(kind="REFUSED", reply_text=format_refused(reason, url), target=url)
        if on_scan_start:
            await on_scan_start("IMAGE")
        try:
            caption = (msg.text or "").strip() or None
            if caption and caption.lower() in ("non-text message", "non text message"):
                caption = None
            img_res = await execute_image_scan(
                image_bytes=msg.media_bytes,
                image_url=str(msg.trusted_local_image) if msg.trusted_local_image else url,
                caption=caption,
                reporter_source="WHATSAPP_BOT",
                reporter_unit=reporter_unit,
            )
        except Exception as exc:  # noqa: BLE001 - reply gracefully to the soldier
            print(f"[Triage] image scan failed: {type(exc).__name__}: {exc}")
            return TriageResult(
                kind="ERROR",
                reply_text=(
                    "⚠️ *VISIKARTIKA SHIELD — GAGAL MEMPROSES GAMBAR*\n"
                    f"{SEP}\n"
                    "Mesin Computer Vision tidak dapat membaca lampiran gambar tersebut. "
                    "Pastikan gambar berformat JPG/PNG yang jelas atau kirimkan tautan situsnya secara langsung."
                ),
            )
        return TriageResult(
            kind="IMAGE",
            reply_text=format_image_report(img_res, include_evidence_link=False),
            evidence_image_path=BASE_DIR / img_res.annotated_dom_path,
            evidence_image_url=img_res.annotated_bbox_url,
            target=img_res.source_image,
            scan_meta={
                "triage_type": "IMAGE",
                "scan_id": img_res.scan_id,
                "verdict": img_res.verdict,
                "content_category": img_res.content_category,
                "layout_type": img_res.layout_type,
                "total_risk_score": img_res.total_risk_score,
                "detected_logos_count": len(img_res.detected_logos),
                "decoded_qr_count": len(img_res.decoded_qr_codes),
                "applied_rules": img_res.applied_rules,
                "annotated_bbox_url": img_res.annotated_bbox_url,
                "supabase_synced": img_res.supabase_synced,
                "supabase_incident_id": img_res.supabase_incident_id,
                "execution_time_sec": img_res.execution_time_sec,
            },
        )

    if kind == "URL" and url:
        allowed, reason = await asyncio.to_thread(validate_chat_target_url, url)
        if not allowed:
            return TriageResult(kind="REFUSED", reply_text=format_refused(reason, url), target=url)
        if on_scan_start:
            await on_scan_start("URL")
        try:
            scan_res = await execute_phase2_scan(
                target_url=url,
                reporter_source="WHATSAPP_BOT",
                reporter_unit=reporter_unit,
            )
        except Exception as exc:  # noqa: BLE001
            print(f"[Triage] URL scan failed for {url}: {type(exc).__name__}: {exc}")
            return TriageResult(
                kind="ERROR",
                target=url,
                reply_text=(
                    "⚠️ *VISIKARTIKA SHIELD — GAGAL MENGAKSES TARGET*\n"
                    f"{SEP}\n"
                    f"🔗 *Tautan*: `{url}`\n\n"
                    "Mesin Sandbox tidak dapat menjangkau alamat tersebut (kemungkinan situs sudah dinonaktifkan, koneksi ditolak, atau domain tidak valid).\n\n"
                    "🔒 _Tetap waspada dan jangan membuka tautan tersebut di browser ponsel Anda._"
                ),
            )
        return TriageResult(
            kind="URL",
            reply_text=format_url_report(scan_res, include_evidence_link=False),
            evidence_image_path=BASE_DIR / scan_res.annotated_dom_path,
            evidence_image_url=scan_res.annotated_bbox_url,
            target=url,
            scan_meta={
                "triage_type": "URL",
                "scan_id": scan_res.scan_id,
                "verdict": scan_res.verdict,
                "content_category": scan_res.content_category,
                "total_risk_score": scan_res.total_risk_score,
                "applied_rules": scan_res.applied_rules,
                "annotated_bbox_url": scan_res.annotated_bbox_url,
                "supabase_synced": scan_res.supabase_synced,
                "supabase_incident_id": scan_res.supabase_incident_id,
                "execution_time_sec": scan_res.execution_time_sec,
            },
        )

    if kind == "MEDIA_UNREADABLE":
        return TriageResult(kind="ERROR", reply_text=format_unreadable_media())

    if kind == "COMMAND":
        cmd = (msg.text or "").lower().lstrip("/").strip()
        if cmd in CMD_PORTAL:
            return TriageResult(kind="COMMAND", reply_text=format_official_portals())
        if cmd in CMD_STATUS:
            return TriageResult(kind="COMMAND", reply_text=await format_system_status())
        return TriageResult(kind="COMMAND", reply_text=format_emergency_guide())

    if kind == "HELP":
        return TriageResult(kind="HELP", reply_text=format_help_menu())

    return TriageResult(kind="IGNORED")


def scanning_ack(kind: str) -> Optional[str]:
    """Short acknowledgement sent before a multi-second scan starts."""
    if kind == "IMAGE":
        return "⏳ _Gambar diterima. Menganalisis poster/screenshot, logo, teks OCR & QR Code…_"
    if kind == "URL":
        return "⏳ _Tautan diterima. Membuka di sandbox terisolasi & menganalisis…_"
    return None
