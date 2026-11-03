"""
VisiKartika Shield — Phase 4 (Zuan / Person A) Verification Suite.

Memverifikasi fokus pengerjaan Zuan pada Phase 4 (`README.md`):
  - Integrasi `PyZbar` + OpenCV Multi-Pass QR Decoder (`app/vision/ocr_quishing.py`)
  - Integrasi `EasyOCR` + Persistent WinRT / Tesseract Poster OCR (`app/vision/image_analyzer.py`)
  - Pengujian endpoint `POST /api/v1/scan-image` (multipart upload & JSON base64)
    untuk Poster Quishing ber-QR, Poster Calo/Scam, dan Poster Resmi TNI AD (< 5.0 detik).

Cara menjalankan (dari folder `backend-engine`):
    python scripts/verify_phase4.py
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import sys
import time
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_ROOT))

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

os.environ.setdefault("VK_OFFLINE_BENCHMARK", "1")

from app.main import MOCK_TARGETS_DIR  # noqa: E402
from app.scanner_service import execute_image_scan  # noqa: E402
from app.vision.image_analyzer import get_vision_capabilities  # noqa: E402


async def main() -> None:
    print("=" * 76)
    print("PHASE 4 (ZUAN) VERIFICATION: QR QUISHING & POSTER OCR (/api/v1/scan-image)")
    print("=" * 76)

    # 1. Vision Stack Capabilities
    caps = get_vision_capabilities()
    print("\n[1] KAPABILITAS MULTIMODAL QR & OCR ENGINE:")
    print(f"    • QR Decoders : {caps['qr_decoders']}")
    print(f"    • OCR Engines : {caps['ocr_engines']}")

    poster_qr = MOCK_TARGETS_DIR / "assets" / "poster_quishing_bintara.png"
    manifest_path = BACKEND_ROOT / "storage" / "dataset" / "posters_and_scams" / "benchmark_manifest.json"

    # Warm-up OCR engine once
    _ = await execute_image_scan(image_bytes=poster_qr.read_bytes(), scan_id="warmup_p4_zuan")

    # 2. Test QR Quishing Poster via file bytes (multipart simulation)
    print("\n[2] UJI SCAN POSTER QUISHING BER-QR (/api/v1/scan-image):")
    t0 = time.perf_counter()
    res_qr = await execute_image_scan(
        image_bytes=poster_qr.read_bytes(),
        caption="Cek poster rekrutmen Bintara QR",
        scan_id="zuan_p4_qr_poster",
    )
    dt_qr = time.perf_counter() - t0
    assert res_qr.verdict == "CRITICAL_PHISHING", f"Expected CRITICAL_PHISHING, got {res_qr.verdict}"
    assert len(res_qr.decoded_qr_codes) >= 1, "QR code pada poster wajib terdeteksi"
    assert dt_qr < 5.0, f"Melebihi batas 5 detik: {dt_qr:.3f}s"
    print(
        f"    [PASS] Verdict={res_qr.verdict} | Skor={res_qr.total_risk_score}/100 | "
        f"Kategori={res_qr.content_category} | Latensi={dt_qr:.3f}s"
    )
    print(f"           QR Terbaca : {[q.payload for q in res_qr.decoded_qr_codes]}")
    print(f"           Annotated  : {res_qr.annotated_dom_path}")
    print(f"           Breakdown  : {res_qr.latency_breakdown_ms}")

    # 3. Test Poster OCR Samples (Calo Scam, APK Malware, & Official Poster) via Base64 JSON
    if manifest_path.exists():
        print("\n[3] UJI POSTER OCR (CALO PUNGLI, APK PHISHING, & POSTER RESMI TNI AD):")
        items = json.loads(manifest_path.read_text(encoding="utf-8"))
        phish_cases = [x for x in items if x["expected_verdict"] == "CRITICAL_PHISHING"][:3]
        safe_cases = [x for x in items if x["expected_verdict"] == "SAFE"][:2]
        selected = phish_cases + safe_cases
        for idx, item in enumerate(selected, start=1):
            img_file = BACKEND_ROOT / item["file"]
            b64_data = base64.b64encode(img_file.read_bytes()).decode("ascii")
            t_s = time.perf_counter()
            res = await execute_image_scan(
                image_base64=b64_data,
                scan_id=f"zuan_p4_case_{idx}",
            )
            dt_s = time.perf_counter() - t_s
            assert res.verdict == item["expected_verdict"], (
                f"Mismatch {item['id']}: got {res.verdict}, expected {item['expected_verdict']}"
            )
            assert dt_s < 5.0, f"Latensi {item['id']} > 5.0s: {dt_s:.3f}s"
            print(
                f"    [PASS] {item['id']:<34} -> {res.verdict:<17} "
                f"(Skor={res.total_risk_score:>5.1f} | {res.content_category:<24} | {dt_s:.3f}s)"
            )

    print("\n[OK] SELURUH DELIVERABLE PHASE 4 (ZUAN) TERVERIFIKASI LULUS 100%!")


if __name__ == "__main__":
    asyncio.run(main())
