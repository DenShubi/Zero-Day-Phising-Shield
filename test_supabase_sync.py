import asyncio
import json
from pathlib import Path
import sys

BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))

from app.scanner_service import execute_phase2_scan
from app.supabase_client import SupabaseService

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


async def main() -> None:
    print("=" * 72)
    print("1. CEK KONEKSI SUPABASE & AUTO-CREATE STORAGE BUCKET")
    print("=" * 72)
    status = await SupabaseService.check_connection()
    print(json.dumps(status, indent=2, ensure_ascii=False))

    if not status.get("connected"):
        print("\n[!] Koneksi tabel belum aktif. Pastikan migrasi SQL sudah dijalankan di Supabase.")
        return

    print("\n" + "=" * 72)
    print("2. SEED 9 PORTAL RESMI TNI AD & KEMHAN KE TABEL `official_portals`")
    print("=" * 72)
    seed_res = await SupabaseService.seed_official_portals()
    print(json.dumps(seed_res, indent=2, ensure_ascii=False))

    print("\n" + "=" * 72)
    print("3. UJI FULL SCAN PHISHING -> UPLOAD GAMBAR -> INSERT `scan_incidents`")
    print("=" * 72)
    phish_target = (BASE_DIR / "mock_targets" / "rekrutmen_bintara_phish.html").resolve().as_uri()
    scan_res = await execute_phase2_scan(
        target_url=phish_target,
        scan_id="sync_test_bintara",
        reporter_source="WEB_SANDBOX",
        reporter_unit="Uji Sinkronisasi Zuan -> Supabase Denin",
    )

    summary = {
        "scan_id": scan_res.scan_id,
        "verdict": scan_res.verdict,
        "total_risk_score": scan_res.total_risk_score,
        "impersonated_target": scan_res.impersonated_target,
        "detected_logos": [lg.model_dump() for lg in scan_res.detected_logos],
        "supabase_synced": scan_res.supabase_synced,
        "supabase_incident_id": scan_res.supabase_incident_id,
        "captured_screenshot_url": scan_res.captured_screenshot_url,
        "annotated_bbox_url": scan_res.annotated_bbox_url,
    }
    print(json.dumps(summary, indent=2, ensure_ascii=False))

    if scan_res.supabase_synced:
        print("\n[OK] SUKSES! Data insiden & gambar bounding box sudah masuk ke Supabase teman Anda!")
    else:
        print("\n[!] Scan selesai secara lokal, tetapi gagal insert ke Supabase. Cek pesan error di atas.")


if __name__ == "__main__":
    asyncio.run(main())

