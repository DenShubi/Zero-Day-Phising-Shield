import asyncio
from pathlib import Path
import sys

BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))

import httpx
from app.main import app

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


async def main() -> None:
    if len(sys.argv) < 2:
        print("Gunakan nomor WA pribadi Anda sebagai penerima balasan bot:")
        print("  python test_wa_live.py 08xxxxxxxxxx")
        print("\nCatatan: Jangan gunakan 085179743602 karena itu adalah nomor Bot Fonnte sendiri.")
        return

    target_phone = sys.argv[1].strip()
    phish_uri = (BASE_DIR / "mock_targets" / "rekrutmen_bintara_phish.html").resolve().as_uri()

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test", timeout=60.0) as client:
        print(f"1. Menguji kirim Menu Panduan & Fitur ('help') ke WA {target_phone} ...")
        r1 = await client.post(
            "/webhook/wa",
            json={"sender": target_phone, "message": "help"},
        )
        print("Status Menu Bantuan:", r1.json().get("status"))

        print(f"\n2. Menguji simulasi prajurit lapor link phishing ke Bot -> Balasan Forensik ke {target_phone} + Masuk Supabase ...")
        r2 = await client.post(
            "/webhook/wa",
            json={
                "sender": target_phone,
                "message": f"Mohon izin cek link rekrutmen ini komandan: {phish_uri}",
            },
        )
        data2 = r2.json()
        print("Scan Meta:", data2.get("scan"))
        print("\nIsi Balasan yang Dikirim ke WhatsApp Anda:\n")
        print(data2.get("reply", ""))


if __name__ == "__main__":
    asyncio.run(main())
