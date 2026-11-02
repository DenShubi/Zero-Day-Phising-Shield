import asyncio
import os

# Local mock server runs on 127.0.0.1 outside /mock-targets/: allow private targets for this dev test.
os.environ.setdefault("ALLOW_PRIVATE_SCAN_TARGETS", "true")
import functools
import http.server
import json
import socketserver
import sys
import threading
import warnings
from pathlib import Path

import cv2
import httpx

if sys.platform == "win32":
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from app.main import app


BASE_DIR = Path(__file__).resolve().parent
MOCK_TARGETS_DIR = BASE_DIR / "mock_targets"


class _QuietHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args: object) -> None:
        pass


def _start_mock_http_server(directory: Path) -> tuple[socketserver.TCPServer, int]:
    handler = functools.partial(_QuietHTTPRequestHandler, directory=str(directory))
    server = socketserver.TCPServer(("127.0.0.1", 0), handler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, port


async def run_e2e_verification() -> None:
    server, port = _start_mock_http_server(MOCK_TARGETS_DIR)
    phish_url = f"http://127.0.0.1:{port}/rekrutmen_bintara_phish.html"
    live_official_url = "https://ad.rekrutmen-tni.mil.id"

    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver", timeout=45.0
        ) as client:
            # 1. Verify Health Check
            health_resp = await client.get("/health")
            assert health_resp.status_code == 200

            # 2. Test Real Official Live Portal (https://ad.rekrutmen-tni.mil.id)
            print("=== [TEST 1] SCANNING REAL OFFICIAL PORTAL: https://ad.rekrutmen-tni.mil.id ===")
            live_resp = await client.post(
                "/api/v1/scan/phase2",
                json={"url": live_official_url, "scan_id": "live_rekrutmen_mil_id"},
            )
            assert live_resp.status_code == 200, f"Live scan failed: {live_resp.text}"
            live_data = live_resp.json()
            assert live_data["risk_analysis"]["is_official_mil_domain"] is True
            assert live_data["verdict"] == "SAFE"
            assert live_data["total_risk_score"] == 0.0
            assert len(live_data["detected_logos"]) >= 1
            print(
                f"-> Live Verdict: {live_data['verdict']} | "
                f"Visual Similarity: {live_data['visual_similarity_score']}% | "
                f"Detected Logos: {len(live_data['detected_logos'])}"
            )

            # 3. Test Phishing Impersonation Clone using Real TNI AD & Panpus Logos
            print("\n=== [TEST 2] SCANNING PHISHING IMPERSONATION CLONE (REAL LOGOS + EXFIL FORM) ===")
            phish_resp = await client.post(
                "/api/v1/scan/phase2",
                json={"url": phish_url, "scan_id": "phish_panpus_001"},
            )
            assert phish_resp.status_code == 200, f"Phish scan failed: {phish_resp.text}"
            phish_data = phish_resp.json()

            screenshot_abs = BASE_DIR / phish_data["screenshot_path"]
            annotated_abs = BASE_DIR / phish_data["annotated_dom_path"]
            assert screenshot_abs.exists()
            assert annotated_abs.exists()

            raw_img = cv2.imread(str(screenshot_abs))
            ann_img = cv2.imread(str(annotated_abs))
            assert raw_img is not None and raw_img.shape == (720, 1280, 3)
            assert ann_img is not None and ann_img.shape == (720, 1280, 3)

            assert phish_data["verdict"] == "CRITICAL_PHISHING"
            assert phish_data["risk_analysis"]["has_credential_harvesting"] is True
            assert phish_data["risk_analysis"]["dom_anomaly_score"] >= 80.0
            assert phish_data["total_risk_score"] >= 85.0
            assert len(phish_data["detected_logos"]) >= 2

            print(json.dumps(phish_data, indent=2, ensure_ascii=False))
            print("\n✅ PHASE 1 & PHASE 2 REAL-DATA E2E VERIFICATION COMPLETE")
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    asyncio.run(run_e2e_verification())
