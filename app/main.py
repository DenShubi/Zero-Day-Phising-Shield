import asyncio
import sys
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.models import Phase1ScanRequest, Phase1ScanResponse
from app.sandbox.browser import HeadlessSandboxScanner

import warnings

if sys.platform == "win32":
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

BASE_DIR = Path(__file__).resolve().parent.parent
STORAGE_DIR = BASE_DIR / "storage"
SCREENSHOTS_DIR = STORAGE_DIR / "screenshots"
ANNOTATED_DIR = STORAGE_DIR / "annotated"
MOCK_TARGETS_DIR = BASE_DIR / "mock_targets"

SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)
ANNOTATED_DIR.mkdir(parents=True, exist_ok=True)
MOCK_TARGETS_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(
    title="VisiKartika Shield - Phase 1 Sandbox & DOM Telemetry API",
    description=(
        "Defensive Cybersecurity Sandbox Engine (Kategori: Penangkalan) "
        "for Kartika Cyber Hackathon 2026 (PUSSIBERAD TNI AD)."
    ),
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount(
    "/static/screenshots",
    StaticFiles(directory=str(SCREENSHOTS_DIR)),
    name="screenshots",
)
app.mount(
    "/static/annotated",
    StaticFiles(directory=str(ANNOTATED_DIR)),
    name="annotated",
)
app.mount(
    "/mock-targets",
    StaticFiles(directory=str(MOCK_TARGETS_DIR), html=True),
    name="mock-targets",
)

scanner = HeadlessSandboxScanner(base_storage_dir=STORAGE_DIR)


@app.get("/health")
async def health_check() -> dict[str, str]:
    return {
        "status": "healthy",
        "service": "visikartika-shield-phase1",
        "platform": sys.platform,
    }


@app.post("/api/v1/scan/phase1", response_model=Phase1ScanResponse)
async def run_phase1_scan(payload: Phase1ScanRequest) -> Phase1ScanResponse:
    target_url = payload.url.strip()
    if not target_url:
        raise HTTPException(status_code=400, detail="Target URL must not be empty.")

    try:
        result = await scanner.capture_and_extract(
            target_url=target_url,
            scan_id=payload.scan_id,
        )
        return result
    except Exception as exc:
        err_msg = str(exc) or repr(exc)
        raise HTTPException(
            status_code=500,
            detail=f"Sandbox scan failed for '{target_url}': {type(exc).__name__}: {err_msg}",
        ) from exc

