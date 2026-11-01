import asyncio
import json
import sys
import warnings

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import BASE_DIR
from app.models import Phase1ScanRequest, Phase1ScanResponse, Phase2ScanResponse
from app.scanner_service import execute_phase1_scan, execute_phase2_scan
from app.supabase_client import SupabaseService
from app.webhook_wa import router as wa_router

if sys.platform == "win32":
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

STORAGE_DIR = BASE_DIR / "storage"
SCREENSHOTS_DIR = STORAGE_DIR / "screenshots"
ANNOTATED_DIR = STORAGE_DIR / "annotated"
MOCK_TARGETS_DIR = BASE_DIR / "mock_targets"
REF_PORTALS_DIR = BASE_DIR / "app" / "reference_db" / "portals"

SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)
ANNOTATED_DIR.mkdir(parents=True, exist_ok=True)
MOCK_TARGETS_DIR.mkdir(parents=True, exist_ok=True)
REF_PORTALS_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(
    title="VisiKartika Shield - Sandbox, Vision & SOC Integration API",
    description=(
        "Defensive Cybersecurity Sandbox Engine (Kategori: Penangkalan) "
        "for Kartika Cyber Hackathon 2026 (PUSSIBERAD TNI AD)."
    ),
    version="1.2.0",
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
    "/static/reference",
    StaticFiles(directory=str(REF_PORTALS_DIR)),
    name="reference-portals",
)
app.mount(
    "/mock-targets",
    StaticFiles(directory=str(MOCK_TARGETS_DIR), html=True),
    name="mock-targets",
)

# Person B: WhatsApp Lapor Cepat Webhook Router
app.include_router(wa_router)


@app.get("/health", tags=["System"])
async def health_check() -> dict[str, object]:
    return {
        "status": "healthy",
        "service": "visikartika-shield-engine",
        "platform": sys.platform,
        "supabase_configured": SupabaseService.is_configured(),
    }


@app.get("/api/v1/supabase/status", tags=["Supabase SOC Sync"])
async def supabase_status() -> dict[str, object]:
    """Check connection status to Person B's Supabase tables & Storage bucket."""
    return await SupabaseService.check_connection()


@app.post("/api/v1/supabase/seed-portals", tags=["Supabase SOC Sync"])
async def seed_supabase_portals() -> dict[str, object]:
    """Upload all 9 official TNI AD / Kemhan reference portals into Supabase `official_portals`."""
    return await SupabaseService.seed_official_portals()


@app.get("/api/v1/incidents", tags=["Supabase SOC Sync"])
async def get_recent_incidents(limit: int = Query(default=20, ge=1, le=100)) -> dict[str, object]:
    """Fetch recent phishing scan incidents from Supabase `scan_incidents`."""
    return await SupabaseService.list_recent_incidents(limit=limit)


@app.get("/api/v1/reference-portals", tags=["Reference Dataset"])
async def list_reference_portals() -> dict[str, object]:
    manifest_file = BASE_DIR / "app" / "reference_db" / "manifest.json"
    portals = []
    if manifest_file.exists():
        portals = json.loads(manifest_file.read_text(encoding="utf-8"))
    logos = sorted(
        p.name for p in (BASE_DIR / "app" / "reference_db" / "logos").glob("*.png")
    )
    return {
        "total_portals": len(portals),
        "total_logos": len(logos),
        "logos": logos,
        "portals": portals,
    }


@app.get("/api/v1/mock-targets", tags=["Reference Dataset"])
async def list_mock_targets() -> dict[str, object]:
    targets = [
        {
            "filename": p.name,
            "url": f"http://localhost:8000/mock-targets/{p.name}",
        }
        for p in sorted(MOCK_TARGETS_DIR.glob("*.html"))
    ]
    return {"total_targets": len(targets), "targets": targets}


@app.post("/api/v1/scan/phase1", response_model=Phase1ScanResponse, tags=["Sandbox Scanner"])
async def run_phase1_scan(payload: Phase1ScanRequest) -> Phase1ScanResponse:
    target_url = payload.url.strip()
    if not target_url:
        raise HTTPException(status_code=400, detail="Target URL must not be empty.")

    try:
        return await execute_phase1_scan(
            target_url=target_url,
            scan_id=payload.scan_id,
        )
    except Exception as exc:
        err_msg = str(exc) or repr(exc)
        raise HTTPException(
            status_code=500,
            detail=f"Sandbox scan failed for '{target_url}': {type(exc).__name__}: {err_msg}",
        ) from exc


@app.post("/api/v1/scan/phase2", response_model=Phase2ScanResponse, tags=["Sandbox Scanner"])
@app.post("/api/v1/scan-url", response_model=Phase2ScanResponse, tags=["Sandbox Scanner"])
async def run_phase2_scan(payload: Phase1ScanRequest) -> Phase2ScanResponse:
    target_url = payload.url.strip()
    if not target_url:
        raise HTTPException(status_code=400, detail="Target URL must not be empty.")

    try:
        return await execute_phase2_scan(
            target_url=target_url,
            scan_id=payload.scan_id,
            reporter_source=payload.reporter_source,
            reporter_unit=payload.reporter_unit,
        )
    except Exception as exc:
        err_msg = str(exc) or repr(exc)
        raise HTTPException(
            status_code=500,
            detail=f"Phase 2 scan failed for '{target_url}': {type(exc).__name__}: {err_msg}",
        ) from exc
