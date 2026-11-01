import asyncio
import sys
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

        # 2. Ping test (Simulasi webhook Fonnte kirim 'ping')
        resp2 = await client.post(
            "/webhook/wa",
            json={"sender": "08123456789", "message": "ping"},
        )
        print("POST /webhook/wa [ping]:", resp2.status_code, resp2.json())
        assert resp2.status_code == 200
        assert resp2.json().get("reply") == "Pong"

    print("\n[OK] PING -> PONG WEBHOOK TEST SUCCESSFUL!")


if __name__ == "__main__":
    asyncio.run(main())
