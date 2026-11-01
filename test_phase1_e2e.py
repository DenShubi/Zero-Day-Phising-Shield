import asyncio
import functools
import http.server
import json
import socketserver
import sys
import threading
from pathlib import Path

import cv2
import httpx

import warnings

if sys.platform == "win32":
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from app.main import app
from app.sandbox.annotator import draw_dom_annotations
from app.sandbox.browser import HeadlessSandboxScanner


BASE_DIR = Path(__file__).resolve().parent
MOCK_TARGETS_DIR = BASE_DIR / "mock_targets"
STORAGE_DIR = BASE_DIR / "storage"


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
    target_url = f"http://127.0.0.1:{port}/rekrutmen_bintara_phish.html"

    try:
        scanner = HeadlessSandboxScanner(base_storage_dir=STORAGE_DIR)
        result = await scanner.capture_and_extract(
            target_url=target_url,
            scan_id="test_001",
        )

        screenshot_abs = BASE_DIR / result.screenshot_path
        annotated_abs = BASE_DIR / result.annotated_dom_path

        # Explicitly run draw_dom_annotations() to verify standalone annotator call
        draw_dom_annotations(
            screenshot_path=screenshot_abs,
            annotated_path=annotated_abs,
            forms=result.forms,
            inputs=result.inputs,
        )

        # 1. Verify image files exist and have resolution (720, 1280, 3)
        assert screenshot_abs.exists(), f"Missing raw screenshot: {screenshot_abs}"
        assert annotated_abs.exists(), f"Missing annotated screenshot: {annotated_abs}"

        raw_img = cv2.imread(str(screenshot_abs))
        ann_img = cv2.imread(str(annotated_abs))
        assert raw_img is not None, "Failed to decode raw screenshot with OpenCV"
        assert ann_img is not None, "Failed to decode annotated screenshot with OpenCV"
        assert raw_img.shape == (720, 1280, 3), f"Unexpected raw shape: {raw_img.shape}"
        assert ann_img.shape == (720, 1280, 3), f"Unexpected annotated shape: {ann_img.shape}"

        # 2. Verify DOM telemetry and risk scoring assertions
        assert result.success is True
        assert len(result.forms) >= 1, "Expected at least 1 <form> detected"
        assert result.forms[0].is_cross_origin is True, "Expected cross-origin form exfiltration flag"
        assert len(result.inputs) >= 2, "Expected at least 2 <input> fields (nrp_nik & kata_sandi)"
        assert any(inp.is_sensitive_credential for inp in result.inputs), "Expected sensitive input flag"
        assert len(result.images) >= 1, "Expected crest/logo <img> (>=30x30) detected"
        assert len(result.detected_military_keywords) >= 5, "Expected military bait keywords detected"
        assert result.risk_analysis.has_credential_harvesting is True, "Expected has_credential_harvesting == True"
        assert result.risk_analysis.dom_anomaly_score >= 80.0, (
            f"Expected dom_anomaly_score >= 80, got {result.risk_analysis.dom_anomaly_score}"
        )

        # 3. Verify FastAPI endpoints (/health and POST /api/v1/scan/phase1)
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            health_resp = await client.get("/health")
            assert health_resp.status_code == 200
            assert health_resp.json()["status"] == "healthy"

            api_resp = await client.post(
                "/api/v1/scan/phase1",
                json={"url": target_url, "scan_id": "test_api_001"},
            )
            assert api_resp.status_code == 200, f"FastAPI endpoint failed: {api_resp.text}"
            api_data = api_resp.json()
            assert api_data["risk_analysis"]["has_credential_harvesting"] is True
            assert api_data["risk_analysis"]["dom_anomaly_score"] >= 80.0

        print(json.dumps(result.model_dump(), indent=2, ensure_ascii=False))
        print("\n✅ PHASE 1 ZUAN COMPLETE & VERIFIED")
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    asyncio.run(run_e2e_verification())

