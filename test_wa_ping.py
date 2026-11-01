import asyncio
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

import httpx
from app.main import app

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


async def main():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Health check
        resp1 = await client.get("/webhook/wa")
        print("GET /webhook/wa:", resp1.status_code, resp1.json())
        assert resp1.status_code == 200

        # 2. Help menu test
        resp_help = await client.post(
            "/webhook/wa",
            json={"sender": "", "message": "help"},
        )
        print("\n--- [1] MENU BANTUAN (help) ---")
        print(resp_help.json().get("reply"))
        assert resp_help.status_code == 200
        assert "VISIKARTIKA SHIELD" in resp_help.json().get("reply", "")

        # 3. Official Portals list test
        resp_portal = await client.post(
            "/webhook/wa",
            json={"sender": "", "message": "portal"},
        )
        print("\n--- [2] DAFTAR PORTAL RESMI (portal) ---")
        print(resp_portal.json().get("reply"))
        assert resp_portal.status_code == 200
        assert "tniad.mil.id" in resp_portal.json().get("reply", "")

        # 4. System Status test
        resp_status = await client.post(
            "/webhook/wa",
            json={"sender": "", "message": "status"},
        )
        print("\n--- [3] STATUS OPERASIONAL (status) ---")
        print(resp_status.json().get("reply"))
        assert resp_status.status_code == 200
        assert "STATUS OPERASIONAL" in resp_status.json().get("reply", "")

        # 5. Emergency Protocol test
        resp_darurat = await client.post(
            "/webhook/wa",
            json={"sender": "", "message": "darurat"},
        )
        print("\n--- [4] PROTOKOL DARURAT (darurat) ---")
        print(resp_darurat.json().get("reply"))
        assert resp_darurat.status_code == 200
        assert "PROTOKOL DARURAT" in resp_darurat.json().get("reply", "")

    print("\n[OK] PROFESSIONAL WHATSAPP BOT COMMANDS VERIFIED!")


if __name__ == "__main__":
    asyncio.run(main())
