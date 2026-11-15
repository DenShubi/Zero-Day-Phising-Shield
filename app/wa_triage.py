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
LAYOUT_LABELS: dict[str, str] = {
    "POSTER_OR_BANNER": "Poster / Selebaran",
    "MOBILE_SCREENSHOT": "Tangkapan Layar HP",
    "WEB_SCREENSHOT": "Tangkapan Layar Web",
    "GENERAL_IMAGE": "Gambar Umum",
}


def format_help_menu() -> str:
    return (
        "*Jagabaya | Pemeriksaan Tautan & Poster*\n"
        "Teruskan tautan atau gambar mencurigakan ke chat ini untuk diperiksa secara otomatis.\n\n"
        "Perintah yang tersedia:\n"
        "- *portal* : Daftar domain resmi .mil.id dan .go.id\n"
        "- *status* : Status koneksi mesin pemindai dan SOC\n"
        "- *darurat*: Langkah penanganan jika kredensial bocor"
    )


def format_official_portals() -> str:
    domain_lines = "\n".join(f"- `https://{d}`" for d in sorted(OFFICIAL_MIL_DOMAINS))
    return (
        "*Daftar Domain Resmi TNI AD & Kemhan RI*\n"
        "Pastikan halaman kedinasan atau rekrutmen yang diakses menggunakan domain resmi berikut:\n\n"
        f"{domain_lines}\n\n"
        "Catatan:\n"
        "TNI AD tidak memungut biaya rekrutmen dan tidak menggunakan domain komersial (`.com`, `.xyz`, `.net`, atau `.id` non-militer) untuk login SSO maupun Sisfopers."
    )


def format_emergency_guide() -> str:
    return (
        "*Penanganan Darurat Kebocoran Kredensial*\n"
        "Jika NRP, NIK, kata sandi, atau kode OTP sudah terlanjur dimasukkan ke situs mencurigakan:\n\n"
        "1. *Ganti kata sandi segera*: Ubah kata sandi akun SSO, Sisfopers, atau email kedinasan melalui perangkat lain yang aman.\n"
        "2. *Cabut sesi aktif*: Keluar (logout) dari semua sesi perangkat yang tidak dikenal.\n"
        "3. *Periksa aplikasi asing*: Hapus file `.apk` di luar Play Store jika sempat terunduh, lalu matikan koneksi data sementara.\n"
        "4. *Lapor ke pejabat siber satuan*: Teruskan tautan atau gambar ke chat ini agar domain penyerang dapat segera diblokir."
    )


async def format_system_status() -> str:
    sb_info = await SupabaseService.check_connection()
    sb_status = "Terhubung (Realtime Aktif)" if sb_info.get("connected") else "Mode Lokal"
    inc_count = sb_info.get("incidents_count_sample", 0)
    portal_count = sb_info.get("portals_count_sample") or len(OFFICIAL_MIL_DOMAINS)
    return (
        "*Status Operasional Jagabaya*\n"
        "Sandbox Browser : Aktif\n"
        "Deteksi Visual  : Aktif (SSIM, Logo, QR, OCR)\n"
        "Analisis Halaman: Aktif\n"
        f"Koneksi SOC     : {sb_status}\n"
        f"Portal Resmi    : {portal_count} domain terdaftar\n"
        f"Arsip Insiden   : {inc_count} rekaman\n\n"
        "Kirimkan tautan atau gambar kapan saja untuk diperiksa."
    )


def _verdict_block(verdict: str, kind: str, content_category: str = "UNKNOWN") -> tuple[str, str, str]:
    if verdict == "CRITICAL_PHISHING":
        if kind == "IMAGE":
            if content_category == "GENERIC_PHISHING":
                return (
                    "*Putusan: BERBAHAYA (Gambar Penipuan Terdeteksi)*",
                    "BERBAHAYA",
                    "Saran:\n"
                    "Jangan memindai kode QR, mengunduh file `.apk`, atau mengisi PIN, OTP, maupun kata sandi dari gambar ini. Bukti temuan telah diteruskan ke SOC untuk ditindaklanjuti.",
                )
            return (
                "*Putusan: BERBAHAYA (Poster / QR Palsu Terdeteksi)*",
                "BERBAHAYA",
                "Saran:\n"
                "Jangan memindai kode QR, menghubungi nomor pada gambar, atau membuka tautan di luar domain resmi `.mil.id`. Bukti temuan telah diteruskan ke SOC untuk pemblokiran.",
            )
        if content_category == "GENERIC_PHISHING":
            return (
                "*Putusan: BERBAHAYA (Situs Phishing Terdeteksi)*",
                "BERBAHAYA",
                "Saran:\n"
                "Jangan mengisi kata sandi, PIN, kode OTP, atau data pribadi pada halaman ini.",
            )
        return (
            "*Putusan: BERBAHAYA (Phishing Terdeteksi)*",
            "BERBAHAYA",
            "Saran:\n"
            "Jangan mengisi NRP, NIK, kata sandi, atau kode OTP pada halaman ini, dan jangan meneruskan tautan ke grup satuan atau keluarga. Domain telah diteruskan ke SOC untuk pemblokiran.",
        )
    if verdict == "SUSPICIOUS":
        if kind == "IMAGE":
            return (
                "*Putusan: WASPADA (Gambar Mencurigakan)*",
                "MENCURIGAKAN",
                "Saran:\n"
                "Gambar ini memuat atribut atau tautan yang belum terverifikasi. Pastikan informasi hanya berasal dari domain resmi `.mil.id` (ketik *portal* untuk melihat daftar).",
            )
        return (
            "*Putusan: WASPADA (Tautan Mencurigakan)*",
            "MENCURIGAKAN",
            "Saran:\n"
            "Tautan ini memiliki anomali keamanan dan bukan portal resmi `.mil.id`. Hindari mengisi data pribadi atau kredensial kedinasan sebelum diverifikasi petugas siber satuan.",
        )
    if kind == "IMAGE":
        if content_category in ("OFFICIAL_MILITARY", "POSTER_OFFICIAL_MILITARY"):
            return (
                "*Putusan: AMAN (Publikasi Militer Resmi)*",
                "AMAN (Publikasi Resmi)",
                "Catatan:\n"
                "Gambar memuat informasi resmi tanpa tautan mencurigakan maupun kode QR palsu.",
            )
        return (
            "*Putusan: AMAN (Gambar Umum)*",
            "AMAN (Konten Umum)",
            "Catatan:\n"
            "Tidak ditemukan indikasi phishing, kode QR berbahaya, maupun penyalahgunaan atribut TNI AD pada gambar ini.",
        )
    if content_category == "OFFICIAL_MILITARY":
        return (
            "*Putusan: AMAN (Portal Resmi)*",
            "AMAN (Portal Resmi .mil.id)",
            "Catatan:\n"
            "Domain terdaftar sebagai portal resmi TNI AD / Kemhan RI.",
        )
    return (
        "*Putusan: AMAN (Situs Umum)*",
        "AMAN (Situs Umum Non-Kedinasan)",
        "Catatan:\n"
        "Tidak ditemukan indikasi pencurian kredensial atau pemalsuan identitas militer. Tetap gunakan NRP dan akun Sisfopers hanya pada domain resmi `.mil.id`.",
    )


def _is_public_evidence_url(url: Optional[str]) -> bool:
    return bool(url) and not str(url).startswith(("http://localhost", "http://127.0.0.1"))


def _ticket_line(incident_id: Optional[str]) -> Optional[str]:
    if not incident_id:
        return None
    return f"Tiket SOC  : `#JB-{str(incident_id).split('-')[0].upper()}`"


def format_url_report(scan_res, include_evidence_link: bool = True) -> str:
    is_off = bool(getattr(getattr(scan_res, "risk_analysis", None), "is_official_mil_domain", False))
    cat = getattr(scan_res, "content_category", "") or ("OFFICIAL_MILITARY" if is_off else "UNKNOWN")
    header, status_label, advice = _verdict_block(scan_res.verdict, "URL", cat)
    lines = [header]
    ticket = _ticket_line(scan_res.supabase_incident_id)
    if ticket:
        lines.append(ticket)
    lines.extend([
        "",
        f"Target     : {scan_res.final_url}",
        f"Status     : {status_label}",
    ])
    if scan_res.impersonated_target and scan_res.verdict != "SAFE":
        lines.append(f"Meniru     : {scan_res.impersonated_target}")
    if scan_res.detected_logos:
        brands = ", ".join(f"{lg.brand_name} ({lg.confidence:.0f}%)" for lg in scan_res.detected_logos[:2])
        lines.append(f"Atribut    : {brands}")
    lines.extend([
        f"Skor Risiko: {scan_res.total_risk_score:.1f} / 100",
        f"- Kemiripan tampilan : {scan_res.visual_similarity_score:.1f}%",
        f"- Perilaku halaman   : {scan_res.risk_analysis.dom_anomaly_score:.1f}%",
        f"- Reputasi domain    : {scan_res.risk_analysis.domain_telemetry_score:.1f}%",
    ])
    if scan_res.risk_analysis.forensic_reasons:
        lines.append("\nAlasan:")
        lines.extend(f"- {r}" for r in scan_res.risk_analysis.forensic_reasons[:3])
    if include_evidence_link and _is_public_evidence_url(scan_res.annotated_bbox_url):
        lines.append(f"\nBukti visual: {scan_res.annotated_bbox_url}")
    lines.extend(["", advice])
    return "\n".join(lines)


def format_image_report(img_res, include_evidence_link: bool = True) -> str:
    cat = getattr(img_res, "content_category", "UNKNOWN") or "UNKNOWN"
    raw_layout = getattr(img_res, "layout_type", "GENERAL_IMAGE") or "GENERAL_IMAGE"
    layout_label = LAYOUT_LABELS.get(raw_layout, raw_layout)
    header, status_label, advice = _verdict_block(img_res.verdict, "IMAGE", cat)
    lines = [header]
    ticket = _ticket_line(img_res.supabase_incident_id)
    if ticket:
        lines.append(ticket)
    lines.extend([
        "",
        f"Jenis      : {layout_label}",
        f"Status     : {status_label}",
    ])
    if img_res.impersonated_target and img_res.verdict != "SAFE":
        lines.append(f"Meniru     : {img_res.impersonated_target}")
    if img_res.detected_logos:
        brands = ", ".join(f"{lg.brand_name} ({lg.confidence:.0f}%)" for lg in img_res.detected_logos[:2])
        lines.append(f"Atribut    : {brands}")
    if img_res.decoded_qr_codes:
        qr_list = ", ".join(f"`{q.payload}`" for q in img_res.decoded_qr_codes[:2])
        lines.append(f"Isi QR     : {qr_list}")
    elif img_res.extracted_urls:
        url_list = ", ".join(f"`{u}`" for u in img_res.extracted_urls[:2])
        lines.append(f"Tautan OCR : {url_list}")
    lines.extend([
        f"Skor Risiko: {img_res.total_risk_score:.1f} / 100",
        f"- Kemiripan tampilan : {img_res.visual_similarity_score:.1f}%",
        f"- Konten & kode QR   : {img_res.dom_anomaly_score:.1f}%",
        f"- Reputasi domain    : {img_res.domain_telemetry_score:.1f}%",
    ])
    if img_res.forensic_reasons:
        lines.append("\nAlasan:")
        lines.extend(f"- {r}" for r in img_res.forensic_reasons[:3])
    if include_evidence_link and _is_public_evidence_url(img_res.annotated_bbox_url):
        lines.append(f"\nBukti visual: {img_res.annotated_bbox_url}")
    lines.extend(["", advice])
    return "\n".join(lines)


def format_evidence_caption(verdict: str, score: float, kind: str) -> str:
    """Short caption (<1024 chars, WhatsApp media limit) for the annotated evidence image."""
    verdict_label = {
        "CRITICAL_PHISHING": "BERBAHAYA",
        "SUSPICIOUS": "MENCURIGAKAN",
    }.get(verdict, "AMAN")
    what = "poster/gambar" if kind == "IMAGE" else "halaman"
    return (
        f"*Bukti Pemeriksaan Jagabaya*\n"
        f"Putusan: {verdict_label} ({score:.1f}/100)\n"
        f"Kotak merah menandai atribut militer, kotak oranye/ungu menandai form login atau kode QR pada {what}."
    )


def format_refused(reason: str, url: str) -> str:
    return (
        "*Jagabaya | Tautan Ditolak*\n"
        f"Target: `{url}`\n\n"
        f"{reason}\n\n"
        "Kirimkan tautan situs publik (https://...) atau tangkapan layarnya."
    )


def format_unreadable_media() -> str:
    return (
        "*Jagabaya | Lampiran Tidak Terbaca*\n"
        "Lampiran diterima, namun bukan format gambar yang dapat diperiksa.\n"
        "Kirim ulang sebagai foto (JPG/PNG), atau kirimkan tautan situsnya secara langsung."
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
                    "*Jagabaya | Gagal Memproses Gambar*\n"
                    "Lampiran gambar tidak dapat dibaca oleh sistem pemeriksa. "
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
                    "*Jagabaya | Gagal Mengakses Target*\n"
                    f"Target: `{url}`\n\n"
                    "Alamat tersebut tidak dapat dijangkau oleh sandbox (kemungkinan situs sudah tidak aktif, koneksi ditolak, atau domain tidak valid).\n\n"
                    "Saran: Tetap waspada dan jangan membuka tautan tersebut di browser ponsel Anda."
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
        return "_Memeriksa gambar (logo, teks OCR, dan kode QR)..._"
    if kind == "URL":
        return "_Memeriksa tautan di sandbox terisolasi..._"
    return None
