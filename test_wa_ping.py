import asyncio
from pathlib import Path
import sys

BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))

import cv2
import httpx
import numpy as np
from app.main import app

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def _build_mock_quishing_poster() -> Path:
    """
    Create a realistic mock Quishing recruitment poster PNG in
    `mock_targets/assets/poster_quishing_bintara.png` containing the official
    TNI AD / Panpus emblem and a QR code encoding a fake phishing domain.
    """
    poster_path = BASE_DIR / "mock_targets" / "assets" / "poster_quishing_bintara.png"
    poster_path.parent.mkdir(parents=True, exist_ok=True)

    # 1280x720 dark military green poster canvas
    canvas = np.full((720, 1280, 3), (18, 48, 24), dtype=np.uint8)
    cv2.rectangle(canvas, (0, 0), (1280, 120), (10, 32, 15), thickness=-1)
    cv2.rectangle(canvas, (40, 150), (1240, 670), (245, 247, 245), thickness=-1)

    # Paste official logo in the top header
    logo_path = BASE_DIR / "app" / "reference_db" / "logos" / "panpus-logo.png"
    if not logo_path.exists():
        logo_path = BASE_DIR / "mock_targets" / "assets" / "kartika.png"
    if logo_path.exists():
        raw_logo = cv2.imread(str(logo_path), cv2.IMREAD_UNCHANGED)
        if raw_logo is not None:
            lh, lw = raw_logo.shape[:2]
            target_h = 90
            target_w = max(40, int(round(target_h * (lw / float(lh)))))
            resized = cv2.resize(raw_logo, (target_w, target_h), interpolation=cv2.INTER_AREA)
            y0, x0 = 15, 50
            if resized.ndim == 3 and resized.shape[2] == 4:
                alpha = resized[:, :, 3:4].astype(np.float32) / 255.0
                bgr = resized[:, :, :3].astype(np.float32)
                roi = canvas[y0 : y0 + target_h, x0 : x0 + target_w].astype(np.float32)
                canvas[y0 : y0 + target_h, x0 : x0 + target_w] = np.clip(
                    alpha * bgr + (1.0 - alpha) * roi, 0, 255
                ).astype(np.uint8)
            else:
                canvas[y0 : y0 + target_h, x0 : x0 + target_w] = resized[:, :, :3]

    # Header & Body Text
    cv2.putText(
        canvas,
        "PANITIA PUSAT PENERIMAAN PRAJURIT TNI AD TA 2026",
        (300, 62),
        cv2.FONT_HERSHEY_DUPLEX,
        0.95,
        (45, 195, 235),
        2,
        cv2.LINE_AA,
    )
    cv2.putText(
        canvas,
        "PENGUMUMAN VERIFIKASI ULANG NRP & KUOTA BINTARA SIBER",
        (80, 220),
        cv2.FONT_HERSHEY_DUPLEX,
        0.95,
        (20, 50, 25),
        2,
        cv2.LINE_AA,
    )
    cv2.putText(
        canvas,
        "Pindai QR Code di sebelah kanan untuk login NRP & Kata Sandi Anda:",
        (80, 280),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.75,
        (50, 50, 50),
        2,
        cv2.LINE_AA,
    )

    # Generate a real QR code pointing to a phishing domain using OpenCV QRCodeEncoder
    phish_qr_url = "https://rekrutmen-bintara-tniad.com/verifikasi-nrp"
    qr_img = None
    if hasattr(cv2, "QRCodeEncoder_create"):
        encoder = cv2.QRCodeEncoder_create()
        qr_raw = encoder.encode(phish_qr_url)
        qr_img = cv2.resize(qr_raw, (260, 260), interpolation=cv2.INTER_NEAREST)
        qr_img = cv2.cvtColor(qr_img, cv2.COLOR_GRAY2BGR)

    if qr_img is not None:
        qx, qy = 880, 320
        cv2.rectangle(canvas, (qx - 15, qy - 15), (qx + 275, qy + 275), (255, 255, 255), -1)
        cv2.rectangle(canvas, (qx - 15, qy - 15), (qx + 275, qy + 275), (30, 30, 30), 2)
        canvas[qy : qy + 260, qx : qx + 260] = qr_img

    cv2.imwrite(str(poster_path), canvas)
    return poster_path


async def main():
    poster_path = _build_mock_quishing_poster()
    print(f"[+] Mock Quishing Poster generated at: {poster_path}")

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test", timeout=60.0) as client:
        # 1. Health check
        resp1 = await client.get("/webhook/wa")
        print("GET /webhook/wa:", resp1.status_code, resp1.json())
        assert resp1.status_code == 200

        # 2. Help menu test
        resp_help = await client.post(
            "/webhook/wa",
            json={"sender": "", "message": "help"},
        )
        assert resp_help.status_code == 200
        assert "VISIKARTIKA SHIELD" in resp_help.json().get("reply", "")

        # 3. Direct POST /api/v1/scan-image test
        print("\n--- [TEST 1] POST /api/v1/scan-image (Quishing Poster) ---")
        resp_img_api = await client.post(
            "/api/v1/scan-image",
            json={
                "image_url": str(poster_path),
                "scan_id": "quishing_poster_001",
                "reporter_source": "WEB_SANDBOX",
                "reporter_unit": "Uji Juri - Quishing Poster",
            },
        )
        assert resp_img_api.status_code == 200, resp_img_api.text
        img_data = resp_img_api.json()
        print("Verdict:", img_data["verdict"], "| Total Risk Score:", img_data["total_risk_score"])
        print("Detected Logos:", img_data["detected_logos"])
        print("Decoded QR Codes:", img_data["decoded_qr_codes"])
        print("Annotated BBox URL (Supabase):", img_data["annotated_bbox_url"])
        print("Supabase Synced:", img_data["supabase_synced"], "| Incident ID:", img_data["supabase_incident_id"])

        # 4. WhatsApp Webhook Image Triage test
        print("\n--- [TEST 2] POST /webhook/wa (Triage Gambar / Screenshot / QR Poster) ---")
        resp_wa_img = await client.post(
            "/webhook/wa",
            json={
                "sender": "",
                "message": "Izin komandan, dapat poster pendaftaran bintara lewat WA grup:",
                "url": str(poster_path),
            },
        )
        assert resp_wa_img.status_code == 200
        wa_data = resp_wa_img.json()
        print("Triage Meta:", wa_data.get("scan"))
        print("\nBalasan Bot WhatsApp untuk Gambar:\n")
        print(wa_data.get("reply"))

    print("\n[OK] IMAGE & QUISHING TRIAGE + SUPABASE UPLOAD VERIFIED!")


if __name__ == "__main__":
    asyncio.run(main())
