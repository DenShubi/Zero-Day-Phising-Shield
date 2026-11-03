"""
VisiKartika Shield - Multimodal Upgrade & .env Verification Suite.

Menguji:
  1. Konfigurasi `.env` terbaru (Supabase & OpenWA Gateway)
  2. Unit guard (Domain Whitelist, Typosquatting, Scoring Fusion)
  3. 10 Skenario Gambar Multimodal (Poster Calo/Quishing, Poster Resmi TNI, Poster Umum Kampus,
     Screenshot Login Non-TNI GitHub, Screenshot Berita Umum, Screenshot Login Phishing TNI,
     Penipuan Umum APK/OTP)
  4. Headless Sandbox URL (Web Umum Non-TNI vs Phishing Militer) & Format Balasan WhatsApp.

Cara menjalankan di terminal (dari folder backend-engine):
    python test_multimodal_upgrade.py
    python test_multimodal_upgrade.py --sync   # jika ingin sekaligus kirim sampel ke Supabase
"""

import argparse
import asyncio
import os
import sys
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

BACKEND_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND_ROOT))

from app import config, domain_guard, scoring, wa_triage  # noqa: E402
from app.scanner_service import execute_image_scan, execute_phase2_scan  # noqa: E402
from app.supabase_client import SupabaseService  # noqa: E402


def _mask(val: str) -> str:
    if not val:
        return "(kosong)"
    if len(val) <= 10:
        return val[:2] + "***"
    return f"{val[:6]}...{val[-4:]} (len={len(val)})"


async def check_env_configuration() -> None:
    print("=" * 76)
    print("1. VERIFIKASI KONFIGURASI .ENV TERBARU (SUPABASE & OPENWA GATEWAY)")
    print("=" * 76)
    sb_url = config.get_env("SUPABASE_URL", aliases=("NEXT_PUBLIC_SUPABASE_URL",))
    sb_key = config.get_env("SUPABASE_SERVICE_ROLE_KEY", aliases=("SUPABASE_KEY", "SUPABASE_ANON_KEY"))
    owa_url = config.get_env("OPENWA_API_URL", default="http://localhost:2785")
    owa_key = config.get_env("OPENWA_API_KEY")
    owa_sid = config.get_env("OPENWA_SESSION_ID")
    owa_sec = config.get_env("OPENWA_WEBHOOK_SECRET")

    print(f"  • SUPABASE_URL          : {sb_url or '(belum diisi)'}")
    print(f"  • SUPABASE_KEY          : {_mask(sb_key)}")
    print(f"  • OPENWA_API_URL        : {owa_url}")
    print(f"  • OPENWA_API_KEY        : {_mask(owa_key)}")
    print(f"  • OPENWA_SESSION_ID     : {owa_sid or '(auto dari payload webhook)'}")
    print(f"  • OPENWA_WEBHOOK_SECRET : {_mask(owa_sec)}")

    sb_status = await SupabaseService.check_connection()
    print(f"  • Status Koneksi Supabase: {'TERHUBUNG (OK)' if sb_status.get('connected') else sb_status.get('message', 'Mode Lokal / Offline')}")


def run_unit_checks() -> None:
    print("\n" + "=" * 76)
    print("2. UJI UNIT DOMAIN GUARD & SCORING ENGINE")
    print("=" * 76)

    for u in ["https://tniad.mil.id", "https://ad.rekrutmen-tni.mil.id/login", "https://www.kemhan.go.id"]:
        a = domain_guard.assess_url(u)
        assert a.is_official and a.risk_score == 0.0, f"Gagal whitelist: {u}"

    for u in ["https://google.com", "https://github.com/login", "https://tokopedia.com"]:
        a_default = domain_guard.assess_url(u)
        a_general = domain_guard.assess_url(u, military_context=False)
        assert not a_default.has_phishing_indicators, f"False phishing indicator pada {u}"
        assert a_general.risk_score == 15.0, f"Skor domain umum salah pada {u}: {a_general.risk_score}"

    a_bait = domain_guard.assess_url("https://rekrutmen-bintara-tniad.com/verifikasi-nrp")
    assert a_bait.risk_score >= 90.0 and a_bait.has_phishing_indicators
    print("  [OK] Domain Whitelist, General Non-TNI Domain, & Lookalike/Bait Guard lulus!")


def _paste_logo(canvas: np.ndarray, logo_path: Path, x: int, y: int, target_h: int) -> None:
    lg = cv2.imread(str(logo_path), cv2.IMREAD_UNCHANGED)
    if lg is None:
        return
    scale = target_h / float(lg.shape[0])
    target_w = max(16, int(round(lg.shape[1] * scale)))
    lg_res = cv2.resize(lg, (target_w, target_h), interpolation=cv2.INTER_AREA)
    if lg_res.shape[2] == 4:
        alpha = (lg_res[:, :, 3:4].astype(np.float32)) / 255.0
        roi = canvas[y : y + target_h, x : x + target_w].astype(np.float32)
        blended = lg_res[:, :, :3].astype(np.float32) * alpha + roi * (1.0 - alpha)
        canvas[y : y + target_h, x : x + target_w] = np.clip(blended, 0, 255).astype(np.uint8)
    else:
        canvas[y : y + target_h, x : x + target_w] = lg_res[:, :, :3]


def build_test_images(out_dir: Path) -> dict[str, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    logos_dir = BACKEND_ROOT / "app" / "reference_db" / "logos"
    panpus_logo = logos_dir / "panpus-logo.png"
    tniad_logo = logos_dir / "logo-tni-ad.png"

    paths: dict[str, Path] = {}

    # 1. Poster Pungli / Calo Rekrutmen TNI (Logo di bagian BAWAH, tanpa QR, teks OCR biaya + WA)
    poster_scam = np.full((1150, 800, 3), (28, 52, 24), dtype=np.uint8)
    cv2.rectangle(poster_scam, (30, 30), (770, 1120), (60, 180, 210), 4)
    cv2.putText(poster_scam, "PENERIMAAN BINTARA TNI AD 2026", (65, 130), cv2.FONT_HERSHEY_SIMPLEX, 1.15, (255, 255, 255), 3, cv2.LINE_AA)
    cv2.putText(poster_scam, "JALUR KHUSUS KUOTA PASTI LULUS", (80, 210), cv2.FONT_HERSHEY_SIMPLEX, 1.05, (0, 215, 255), 3, cv2.LINE_AA)
    cv2.putText(poster_scam, "BIAYA ADMINISTRASI RP 15.000.000", (75, 310), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 255, 255), 2, cv2.LINE_AA)
    cv2.putText(poster_scam, "TRANSFER REKENING PANITIA PUSAT", (85, 380), cv2.FONT_HERSHEY_SIMPLEX, 0.95, (220, 240, 220), 2, cv2.LINE_AA)
    cv2.putText(poster_scam, "HUBUNGI WA: 0812-9988-7766", (130, 470), cv2.FONT_HERSHEY_SIMPLEX, 1.1, (80, 255, 255), 3, cv2.LINE_AA)
    _paste_logo(poster_scam, panpus_logo, 325, 680, 150)
    cv2.putText(poster_scam, "daftar-bintara-cepat.xyz", (165, 950), cv2.FONT_HERSHEY_SIMPLEX, 1.05, (255, 255, 255), 2, cv2.LINE_AA)
    p_scam = out_dir / "synth_poster_calo_scam.png"
    cv2.imwrite(str(p_scam), poster_scam)
    paths["poster_calo_scam"] = p_scam

    # 2. Poster Rekrutmen Resmi TNI AD (Gratis + URL resmi ad.rekrutmen-tni.mil.id)
    poster_official = np.full((1100, 800, 3), (32, 65, 30), dtype=np.uint8)
    _paste_logo(poster_official, tniad_logo, 340, 80, 130)
    cv2.putText(poster_official, "REKRUTMEN PRAJURIT TNI AD", (110, 300), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (255, 255, 255), 3, cv2.LINE_AA)
    cv2.putText(poster_official, "GRATIS TIDAK DIPUNGUT BIAYA", (110, 400), cv2.FONT_HERSHEY_SIMPLEX, 1.1, (100, 255, 180), 3, cv2.LINE_AA)
    cv2.putText(poster_official, "HINDARI CALO PENIPUAN", (165, 480), cv2.FONT_HERSHEY_SIMPLEX, 1.05, (255, 255, 255), 2, cv2.LINE_AA)
    cv2.putText(poster_official, "https://ad.rekrutmen-tni.mil.id", (105, 620), cv2.FONT_HERSHEY_SIMPLEX, 1.1, (80, 230, 255), 3, cv2.LINE_AA)
    p_off = out_dir / "synth_poster_official_safe.png"
    cv2.imwrite(str(p_off), poster_official)
    paths["poster_official_safe"] = p_off

    # 3. Poster Ucapan Dirgahayu TNI AD (Tanpa URL & Tanpa QR)
    poster_hut = np.full((1000, 800, 3), (25, 48, 25), dtype=np.uint8)
    _paste_logo(poster_hut, tniad_logo, 340, 120, 130)
    cv2.putText(poster_hut, "DIRGAHAYU TNI ANGKATAN DARAT", (85, 380), cv2.FONT_HERSHEY_SIMPLEX, 1.1, (255, 255, 255), 3, cv2.LINE_AA)
    cv2.putText(poster_hut, "BERSAMA RAKYAT TNI KUAT", (140, 470), cv2.FONT_HERSHEY_SIMPLEX, 1.1, (120, 220, 255), 3, cv2.LINE_AA)
    p_hut = out_dir / "synth_poster_hut_benign.png"
    cv2.imwrite(str(p_hut), poster_hut)
    paths["poster_hut_benign"] = p_hut

    # 4. Poster Umum Non-TNI (Seminar Kampus)
    poster_campus = np.full((1100, 800, 3), (245, 240, 230), dtype=np.uint8)
    cv2.rectangle(poster_campus, (0, 0), (800, 220), (160, 70, 20), -1)
    cv2.putText(poster_campus, "SEMINAR NASIONAL TEKNOLOGI AI", (75, 110), cv2.FONT_HERSHEY_SIMPLEX, 1.15, (255, 255, 255), 3, cv2.LINE_AA)
    cv2.putText(poster_campus, "UNIVERSITAS INDONESIA 2026", (125, 175), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (230, 230, 255), 2, cv2.LINE_AA)
    cv2.putText(poster_campus, "TERBUKA UNTUK MAHASISWA UMUM", (95, 360), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (40, 40, 40), 2, cv2.LINE_AA)
    cv2.putText(poster_campus, "Info: https://ui.ac.id/seminar", (130, 520), cv2.FONT_HERSHEY_SIMPLEX, 1.1, (140, 50, 10), 3, cv2.LINE_AA)
    p_campus = out_dir / "synth_poster_general_campus.png"
    cv2.imwrite(str(p_campus), poster_campus)
    paths["poster_general_campus"] = p_campus

    # 5. Screenshot Web Login Bukan Phishing & Bukan TNI (GitHub Login)
    web_general = np.full((720, 1280, 3), (250, 251, 253), dtype=np.uint8)
    cv2.rectangle(web_general, (0, 0), (1280, 52), (232, 234, 237), -1)
    cv2.rectangle(web_general, (140, 10), (960, 42), (255, 255, 255), -1)
    cv2.putText(web_general, "https://github.com/login", (165, 33), cv2.FONT_HERSHEY_SIMPLEX, 0.75, (50, 50, 50), 2, cv2.LINE_AA)
    cv2.rectangle(web_general, (440, 150), (840, 560), (255, 255, 255), -1)
    cv2.rectangle(web_general, (440, 150), (840, 560), (210, 215, 222), 2)
    cv2.putText(web_general, "Sign in to GitHub", (505, 215), cv2.FONT_HERSHEY_SIMPLEX, 0.95, (30, 35, 40), 2, cv2.LINE_AA)
    cv2.putText(web_general, "Username or email address", (475, 275), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (60, 60, 60), 1, cv2.LINE_AA)
    cv2.rectangle(web_general, (475, 290), (805, 335), (208, 215, 222), 2)
    cv2.putText(web_general, "Password", (475, 380), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (60, 60, 60), 1, cv2.LINE_AA)
    cv2.rectangle(web_general, (475, 395), (805, 440), (208, 215, 222), 2)
    cv2.rectangle(web_general, (475, 470), (805, 518), (45, 164, 78), -1)
    cv2.putText(web_general, "Sign in", (600, 502), cv2.FONT_HERSHEY_SIMPLEX, 0.75, (255, 255, 255), 2, cv2.LINE_AA)
    p_web_gen = out_dir / "synth_screenshot_github_safe.png"
    cv2.imwrite(str(p_web_gen), web_general)
    paths["screenshot_general_web_safe"] = p_web_gen

    # 6. Screenshot Portal Berita Umum Non-TNI (Putih, Tanpa URL Bar)
    web_news = np.full((720, 1280, 3), (255, 255, 255), dtype=np.uint8)
    cv2.rectangle(web_news, (0, 0), (1280, 70), (190, 40, 30), -1)
    cv2.putText(web_news, "PORTAL BERITA HARIAN INDONESIA", (60, 47), cv2.FONT_HERSHEY_SIMPLEX, 1.1, (255, 255, 255), 3, cv2.LINE_AA)
    cv2.rectangle(web_news, (60, 110), (820, 420), (220, 225, 230), -1)
    cv2.putText(web_news, "Perkembangan Ekonomi Digital Nasional Kuartal IV", (60, 480), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (30, 30, 30), 2, cv2.LINE_AA)
    cv2.putText(web_news, "Indeks inovasi industri teknologi meningkat signifikan tahun ini.", (60, 530), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (90, 90, 90), 1, cv2.LINE_AA)
    p_web_news = out_dir / "synth_screenshot_news_safe.png"
    cv2.imwrite(str(p_web_news), web_news)
    paths["screenshot_news_safe"] = p_web_news

    # 7. Screenshot Login Phishing Sisfopers TNI AD (Tanpa QR & Tanpa URL Bar)
    web_mil_phish = np.full((720, 1280, 3), (242, 245, 242), dtype=np.uint8)
    cv2.rectangle(web_mil_phish, (0, 0), (1280, 110), (25, 58, 28), -1)
    _paste_logo(web_mil_phish, panpus_logo, 50, 12, 86)
    cv2.putText(web_mil_phish, "PORTAL VERIFIKASI SISFOPERS TNI AD", (165, 68), cv2.FONT_HERSHEY_SIMPLEX, 1.1, (255, 255, 255), 3, cv2.LINE_AA)
    cv2.rectangle(web_mil_phish, (390, 170), (890, 610), (255, 255, 255), -1)
    cv2.rectangle(web_mil_phish, (390, 170), (890, 610), (180, 190, 180), 2)
    cv2.putText(web_mil_phish, "MASUK AKUN PRAJURIT", (465, 230), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (25, 58, 28), 2, cv2.LINE_AA)
    cv2.putText(web_mil_phish, "Masukkan NRP", (430, 290), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (50, 50, 50), 2, cv2.LINE_AA)
    cv2.rectangle(web_mil_phish, (430, 305), (850, 352), (170, 170, 170), 2)
    cv2.putText(web_mil_phish, "Kata Sandi / Password", (430, 400), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (50, 50, 50), 2, cv2.LINE_AA)
    cv2.rectangle(web_mil_phish, (430, 415), (850, 462), (170, 170, 170), 2)
    cv2.rectangle(web_mil_phish, (430, 500), (850, 555), (30, 95, 40), -1)
    cv2.putText(web_mil_phish, "VERIFIKASI LOGIN", (525, 536), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2, cv2.LINE_AA)
    p_mil_phish = out_dir / "synth_screenshot_mil_login_phish.png"
    cv2.imwrite(str(p_mil_phish), web_mil_phish)
    paths["screenshot_mil_login_phish"] = p_mil_phish

    # 8. Gambar Penipuan Umum Non-TNI (File .apk + Kode OTP + domain .xyz)
    web_gen_phish = np.full((1100, 800, 3), (250, 248, 245), dtype=np.uint8)
    cv2.rectangle(web_gen_phish, (0, 0), (800, 160), (180, 30, 30), -1)
    cv2.putText(web_gen_phish, "PERINGATAN BLOKIR REKENING", (95, 100), cv2.FONT_HERSHEY_SIMPLEX, 1.15, (255, 255, 255), 3, cv2.LINE_AA)
    cv2.putText(web_gen_phish, "Masukkan PIN dan KODE OTP Anda", (95, 300), cv2.FONT_HERSHEY_SIMPLEX, 1.05, (40, 40, 40), 2, cv2.LINE_AA)
    cv2.putText(web_gen_phish, "Unduh Surat_Undangan.apk sekarang", (85, 420), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (190, 20, 20), 2, cv2.LINE_AA)
    cv2.putText(web_gen_phish, "https://konfirmasi-tarif-bank.xyz", (95, 560), cv2.FONT_HERSHEY_SIMPLEX, 1.05, (20, 20, 160), 2, cv2.LINE_AA)
    p_gen_phish = out_dir / "synth_generic_apk_otp_scam.png"
    cv2.imwrite(str(p_gen_phish), web_gen_phish)
    paths["generic_apk_otp_scam"] = p_gen_phish

    return paths


async def run_multimodal_scenarios() -> None:
    print("\n" + "=" * 76)
    print("3. UJI 10 SKENARIO MULTIMODAL (POSTER, SCREENSHOT NON-TNI, & PHISHING)")
    print("=" * 76)

    synth_dir = BACKEND_ROOT / "storage" / "screenshots" / "synth_tests"
    imgs = build_test_images(synth_dir)

    scenarios = [
        (
            "Skenario 01 - Poster Quishing Rekrutmen Bintara (QR Palsu)",
            BACKEND_ROOT / "mock_targets" / "assets" / "poster_quishing_bintara.png",
            "CRITICAL_PHISHING",
        ),
        (
            "Skenario 02 - Poster Calo/Biaya Rekrutmen TNI (Logo di bawah, tanpa QR, OCR Pungli)",
            imgs["poster_calo_scam"],
            "CRITICAL_PHISHING",
        ),
        (
            "Skenario 03 - Poster Rekrutmen Resmi TNI AD (Gratis + ad.rekrutmen-tni.mil.id)",
            imgs["poster_official_safe"],
            "SAFE",
        ),
        (
            "Skenario 04 - Poster Ucapan Dirgahayu TNI AD (Tanpa URL & Tanpa QR)",
            imgs["poster_hut_benign"],
            "SAFE",
        ),
        (
            "Skenario 05 - Poster Seminar Kampus Umum Non-TNI (ui.ac.id)",
            imgs["poster_general_campus"],
            "SAFE",
        ),
        (
            "Skenario 06 - Screenshot Web Login Umum Non-TNI (GitHub Login)",
            imgs["screenshot_general_web_safe"],
            "SAFE",
        ),
        (
            "Skenario 07 - Screenshot Portal Berita Umum Non-TNI (Dominan Putih)",
            imgs["screenshot_news_safe"],
            "SAFE",
        ),
        (
            "Skenario 08 - Screenshot Login Phishing Sisfopers TNI AD (Tanpa QR)",
            imgs["screenshot_mil_login_phish"],
            "CRITICAL_PHISHING",
        ),
        (
            "Skenario 09 - Gambar Penipuan Umum Non-TNI (Undangan .apk + OTP + .xyz)",
            imgs["generic_apk_otp_scam"],
            "CRITICAL_PHISHING",
        ),
        (
            "Skenario 10 - Tangkapan Layar Beranda Resmi tniad.mil.id",
            BACKEND_ROOT / "app" / "reference_db" / "portals" / "tniad_main.png",
            "SAFE",
        ),
    ]

    passed = 0
    sample_safe_non_tni = None
    sample_poster_scam = None

    for title, img_path, expected in scenarios:
        res = await execute_image_scan(
            image_bytes=img_path.read_bytes(),
            scan_id=f"mm_{img_path.stem}",
        )
        ok = res.verdict == expected
        mark = "[PASS]" if ok else "[FAIL]"
        print(
            f"{mark} {title}\n"
            f"       Putusan: {res.verdict} (Ekspektasi: {expected}) | Skor: {res.total_risk_score:.1f}/100 | "
            f"Kategori: {res.content_category} | Layout: {res.layout_type}\n"
            f"       Logo: {len(res.detected_logos)} | FormBox: {res.visual_input_boxes_count} | "
            f"URL(QR/OCR): {res.extracted_urls}"
        )
        if not ok:
            print(f"       Alasan: {res.forensic_reasons}")
            raise AssertionError(f"Skenario gagal pada {title}: dapat {res.verdict}, seharusnya {expected}")
        passed += 1
        if "GitHub" in title:
            sample_safe_non_tni = res
        if "Calo" in title:
            sample_poster_scam = res

    print(f"\n  [OK] {passed}/{len(scenarios)} Skenario Gambar & Poster LULUS 100%!")

    if sample_safe_non_tni and sample_poster_scam:
        print("\n" + "=" * 76)
        print("4. PREVIEW FORMAT BALASAN WHATSAPP BARU (NON-TNI AMAN vs POSTER SCAM)")
        print("=" * 76)
        print("--- [A] Balasan WA untuk Screenshot Web Umum Non-TNI (GitHub Login) ---")
        print(wa_triage.format_image_report(sample_safe_non_tni, include_evidence_link=False))
        print("\n--- [B] Balasan WA untuk Poster Calo Rekrutmen TNI Palsu ---")
        print(wa_triage.format_image_report(sample_poster_scam, include_evidence_link=False))


async def run_sandbox_check() -> None:
    print("\n" + "=" * 76)
    print("5. UJI HEADLESS CHROMIUM SANDBOX (MOCK PHISHING HTML)")
    print("=" * 76)
    phish_uri = (BACKEND_ROOT / "mock_targets" / "rekrutmen_bintara_phish.html").resolve().as_uri()
    res = await execute_phase2_scan(target_url=phish_uri, scan_id="mm_url_bintara")
    print(
        f"  [PASS] Mock Bintara Phishing -> Putusan: {res.verdict} | Skor: {res.total_risk_score}/100 | "
        f"Kategori: {res.content_category}"
    )
    assert res.verdict == "CRITICAL_PHISHING"


async def main() -> None:
    parser = argparse.ArgumentParser(description="Test Multimodal Upgrade VisiKartika Shield")
    parser.add_argument(
        "--sync",
        action="store_true",
        help="Aktifkan sinkronisasi ke Supabase untuk setiap skenario uji (default: lokal agar tabel SOC bersih)",
    )
    args = parser.parse_args()

    # 1. Selalu cek .env asli terlebih dahulu
    await check_env_configuration()

    # 2. Jika tidak pakai --sync, matikan sementara pengiriman 11 sampel uji ke tabel produksi Supabase
    saved_env_file: Optional[Path] = None
    if not args.sync:
        saved_env_file = config.ENV_FILE
        config.ENV_FILE = BACKEND_ROOT / ".no-sync-during-synthetic-test"
        for k in ("SUPABASE_URL", "SUPABASE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_URL"):
            os.environ.pop(k, None)

    try:
        run_unit_checks()
        await run_multimodal_scenarios()
        await run_sandbox_check()
    finally:
        if saved_env_file is not None:
            config.ENV_FILE = saved_env_file

    print("\n" + "=" * 76)
    print("SEMUA PENGUJIAN MULTIMODAL BERHASIL 100%! MODEL SIAP DIGUNAKAN.")
    print("=" * 76)


if __name__ == "__main__":
    asyncio.run(main())

