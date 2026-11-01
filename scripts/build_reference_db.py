"""
Automated Live Reference Database Builder for VisiKartika Shield.

Captures single-page 1280x720 reference screenshots and DOM signatures from
official public TNI / TNI AD / Kemhan portals (.mil.id, .go.id, .ac.id) into
`app/reference_db/portals/` and verifies the real logo templates in
`app/reference_db/logos/`.
"""

import asyncio
import json
import sys
import warnings
from pathlib import Path

from playwright.async_api import async_playwright

if sys.platform == "win32":
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())


BASE_DIR = Path(__file__).resolve().parent.parent
REF_DB_DIR = BASE_DIR / "app" / "reference_db"
LOGOS_DIR = REF_DB_DIR / "logos"
PORTALS_DIR = REF_DB_DIR / "portals"

LIVE_PUBLIC_PORTALS = {
    "rekrutmen_ad_live": {
        "name": "Portal Rekrutmen Prajurit TNI AD (ad.rekrutmen-tni.mil.id)",
        "domain": "ad.rekrutmen-tni.mil.id",
        "url": "https://ad.rekrutmen-tni.mil.id",
    },
    "rekrutmen_tni_pusat": {
        "name": "Portal Rekrutmen Terpadu Mabes TNI (rekrutmen-tni.mil.id)",
        "domain": "rekrutmen-tni.mil.id",
        "url": "https://rekrutmen-tni.mil.id",
    },
    "tniad_main": {
        "name": "Portal Utama TNI Angkatan Darat (tniad.mil.id)",
        "domain": "tniad.mil.id",
        "url": "https://tniad.mil.id",
    },
    "tniad_ppid": {
        "name": "Portal PPID TNI Angkatan Darat (ppid.tniad.mil.id)",
        "domain": "ppid.tniad.mil.id",
        "url": "https://ppid.tniad.mil.id",
    },
    "tni_main": {
        "name": "Portal Resmi Markas Besar TNI (tni.mil.id)",
        "domain": "tni.mil.id",
        "url": "https://tni.mil.id",
    },
    "kemhan_main": {
        "name": "Portal Kementerian Pertahanan RI (www.kemhan.go.id)",
        "domain": "www.kemhan.go.id",
        "url": "https://www.kemhan.go.id",
    },
    "akmil_main": {
        "name": "Portal Akademi Militer TNI AD (www.akmil.ac.id)",
        "domain": "www.akmil.ac.id",
        "url": "https://www.akmil.ac.id",
    },
    "unhan_main": {
        "name": "Portal Universitas Pertahanan RI (www.idu.ac.id)",
        "domain": "www.idu.ac.id",
        "url": "https://www.idu.ac.id",
    },
    "seskoad_main": {
        "name": "Portal Seskoad TNI AD (seskoad.mil.id)",
        "domain": "seskoad.mil.id",
        "url": "https://seskoad.mil.id",
    },
}


async def build_portal_references() -> list[dict]:
    PORTALS_DIR.mkdir(parents=True, exist_ok=True)
    LOGOS_DIR.mkdir(parents=True, exist_ok=True)
    manifest: list[dict] = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
        )
        context = await browser.new_context(
            viewport={"width": 1280, "height": 720},
            ignore_https_errors=True,
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/128.0.0.0 Safari/537.36"
            ),
        )
        page = await context.new_page()

        for key, meta in LIVE_PUBLIC_PORTALS.items():
            try:
                await page.goto(meta["url"], timeout=15000, wait_until="domcontentloaded")
                await page.wait_for_timeout(1000)
                shot_path = PORTALS_DIR / f"{key}.png"
                await page.screenshot(path=str(shot_path), full_page=False)

                dom_sig = await page.evaluate(
                    """({ portalName, officialDomain }) => ({
                        portal_name: portalName,
                        official_domain: officialDomain,
                        title: document.title,
                        forms: document.querySelectorAll('form').length,
                        inputs: document.querySelectorAll('input').length,
                        images: document.querySelectorAll('img').length
                    })""",
                    {"portalName": meta["name"], "officialDomain": meta["domain"]},
                )
                (PORTALS_DIR / f"{key}.json").write_text(
                    json.dumps(dom_sig, indent=2), encoding="utf-8"
                )
                manifest.append(
                    {
                        "id": key,
                        **dom_sig,
                        "screenshot": str(shot_path.relative_to(BASE_DIR)).replace("\\", "/"),
                    }
                )
                print(f"[OK] Captured live official reference: {meta['url']} -> {shot_path.name}")
            except Exception as exc:
                print(f"[SKIP] Live portal {meta['url']} unreachable or timed out: {exc}")

        await context.close()
        await browser.close()

    # Rebuild manifest from all saved .json/.png portal pairs on disk
    all_entries: list[dict] = []
    for json_file in sorted(PORTALS_DIR.glob("*.json")):
        png_file = json_file.with_suffix(".png")
        if not png_file.exists():
            continue
        data = json.loads(json_file.read_text(encoding="utf-8"))
        all_entries.append(
            {
                "id": json_file.stem,
                **data,
                "screenshot": str(png_file.relative_to(BASE_DIR)).replace("\\", "/"),
            }
        )

    manifest_path = REF_DB_DIR / "manifest.json"
    manifest_path.write_text(json.dumps(all_entries, indent=2), encoding="utf-8")
    return all_entries


async def main_async() -> None:
    logos = sorted(p.name for p in LOGOS_DIR.glob("*.png"))
    print(f"[OK] Found {len(logos)} official logo template(s) in {LOGOS_DIR}: {', '.join(logos)}")
    manifest = await build_portal_references()
    print(f"[OK] Reference DB ready with {len(manifest)} live portal template(s) in {PORTALS_DIR}")


if __name__ == "__main__":
    asyncio.run(main_async())
