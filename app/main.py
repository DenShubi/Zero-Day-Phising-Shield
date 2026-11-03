import asyncio
import hmac
import json
import sys
from typing import Optional
import warnings

from fastapi import FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app import domain_guard, security, wa_triage
from app.config import BASE_DIR, get_env
from app.models import (
    ImageScanRequest,
    ImageScanResponse,
    Phase1ScanRequest,
    Phase1ScanResponse,
    Phase2ScanResponse,
)
from app.scanner_service import (
    execute_image_scan,
    execute_phase1_scan,
    execute_phase2_scan,
)
from app.supabase_client import SupabaseService
from app.sandbox.browser import get_sandbox_isolation_profile
from app.vision.image_analyzer import get_vision_capabilities
from app.webhook_wa import router as wa_router
from app.webhook_openwa import router as openwa_router

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
    version="1.4.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=security.cors_origins(),  # set CORS_ORIGINS in .env (comma separated)
    allow_credentials=False,
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

# Person B: WhatsApp Lapor Cepat Webhook Routers (OpenWA Baileys = active, Fonnte = legacy)
app.include_router(wa_router)
app.include_router(openwa_router)


@app.get("/health", tags=["System"])
async def health_check() -> dict[str, object]:
    return {
        "status": "healthy",
        "service": "visikartika-shield-engine",
        "platform": sys.platform,
        "supabase_configured": SupabaseService.is_configured(),
        "vision_capabilities": get_vision_capabilities(),
        "sandbox_isolation": get_sandbox_isolation_profile(),
    }


@app.get("/api/v1/supabase/status", tags=["Supabase SOC Sync"])
async def supabase_status() -> dict[str, object]:
    """Check connection status to Person B's Supabase tables & Storage bucket."""
    return await SupabaseService.check_connection()


@app.post("/api/v1/supabase/seed-portals", tags=["Supabase SOC Sync"])
async def seed_supabase_portals(request: Request) -> dict[str, object]:
    """Upload all 9 official TNI AD / Kemhan reference portals into Supabase `official_portals`.
    Admin-only: call from localhost, or send header `X-Admin-Key: <ADMIN_API_KEY>`."""
    admin_key = get_env("ADMIN_API_KEY")
    supplied = request.headers.get("x-admin-key", "")
    if not (security.is_loopback_request(request) or (admin_key and hmac.compare_digest(supplied, admin_key))):
        raise HTTPException(status_code=403, detail="Admin only.")
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
            "url": f"{get_env('PUBLIC_BACKEND_URL', default='http://localhost:8000').rstrip('/')}/mock-targets/{p.name}",
        }
        for p in sorted(MOCK_TARGETS_DIR.glob("*.html"))
    ]
    return {"total_targets": len(targets), "targets": targets}


@app.get("/api/v1/domain/check", tags=["Phase 2 - Whitelist & Triage"])
async def check_domain(url: str = Query(..., min_length=1, description="URL atau hostname yang akan dicek")) -> dict[str, object]:
    """Cek URL terhadap whitelist resmi `.mil.id` + heuristik lookalike/typosquat (tanpa membuka halaman)."""
    return domain_guard.assess_url(url).as_dict()


@app.post("/api/v1/triage/preview", tags=["Phase 2 - Whitelist & Triage"])
async def preview_triage(payload: dict[str, object]) -> dict[str, object]:
    """
    Preview jalur triage pesan WhatsApp tanpa menjalankan scan.
    Body: `{"text": "...", "has_image": false}`
    """
    text = str(payload.get("text") or "")
    has_image = bool(payload.get("has_image"))
    msg = wa_triage.InboundMessage(
        channel="TEST", sender="preview", text=text, media_bytes=b"preview" if has_image else None
    )
    kind, url = wa_triage.classify_message(msg)
    result: dict[str, object] = {"triage": kind, "target_url": url}
    if url and kind in ("URL", "IMAGE") and not has_image:
        allowed, reason = wa_triage.validate_chat_target_url(url)
        result["allowed"] = allowed
        result["refusal_reason"] = reason or None
        result["domain"] = domain_guard.assess_url(url).as_dict()
    return result


@app.post("/api/v1/scan/phase1", response_model=Phase1ScanResponse, tags=["Sandbox Scanner"])
async def run_phase1_scan(payload: Phase1ScanRequest) -> Phase1ScanResponse:
    target_url = payload.url.strip()
    if not target_url:
        raise HTTPException(status_code=400, detail="Target URL must not be empty.")
    allowed, reason = security.validate_scan_target(target_url)
    if not allowed:
        raise HTTPException(status_code=400, detail=f"Target ditolak: {reason}")

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
    allowed, reason = security.validate_scan_target(target_url)
    if not allowed:
        raise HTTPException(status_code=400, detail=f"Target ditolak: {reason}")

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


@app.post("/api/v1/scan-image", response_model=ImageScanResponse, tags=["Vision & Quishing Scanner"])
async def run_image_scan(
    request: Request,
    file: Optional[UploadFile] = File(default=None),
    image_url: Optional[str] = Form(default=None),
    caption: Optional[str] = Form(default=None),
    scan_id: Optional[str] = Form(default=None),
    reporter_source: str = Form(default="WEB_SANDBOX"),
    reporter_unit: str = Form(default="Simulasi Juri / Satuan Jajaran"),
) -> ImageScanResponse:
    """
    Scan a screenshot or recruitment poster (Quishing QR code + Logo Impersonation + Visual Similarity).
    Supports both `multipart/form-data` (`file` upload) and `application/json` (`ImageScanRequest`).
    """
    raw_bytes: Optional[bytes] = None
    b64_str: Optional[str] = None

    content_type = request.headers.get("content-type", "")
    if "application/json" in content_type:
        body = await request.json()
        parsed_req = ImageScanRequest(**body)
        image_url = parsed_req.image_url
        b64_str = parsed_req.image_base64
        caption = parsed_req.caption
        scan_id = parsed_req.scan_id
        reporter_source = parsed_req.reporter_source
        reporter_unit = parsed_req.reporter_unit
    elif file is not None:
        raw_bytes = await file.read()

    if not raw_bytes and not image_url and not b64_str:
        raise HTTPException(
            status_code=400,
            detail="Harap unggah file gambar (`file`) atau berikan `image_url` / `image_base64`.",
        )

    if image_url and not raw_bytes and not b64_str:
        if image_url.lower().startswith(("http://", "https://")):
            allowed, reason = security.validate_scan_target(image_url)
            if not allowed:
                raise HTTPException(status_code=400, detail=f"image_url ditolak: {reason}")
        else:
            try:
                security.resolve_local_image_path(image_url)
            except PermissionError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        return await execute_image_scan(
            image_bytes=raw_bytes,
            image_url=image_url,
            image_base64=b64_str,
            caption=caption,
            scan_id=scan_id,
            reporter_source=reporter_source,
            reporter_unit=reporter_unit,
        )
    except Exception as exc:
        err_msg = str(exc) or repr(exc)
        raise HTTPException(
            status_code=500,
            detail=f"Image scan failed: {type(exc).__name__}: {err_msg}",
        ) from exc


@app.get("/api/v1/benchmark/phase3", tags=["Phase 3 - Accuracy & Latency Audit"])
async def get_phase3_benchmark_metrics(include_samples: bool = Query(default=False)) -> dict[str, object]:
    """Return latest Phase 3 accuracy & Playwright capture latency audit telemetry."""
    results_file = STORAGE_DIR / "phase3_benchmark_results.json"
    if not results_file.exists():
        return {
            "available": False,
            "message": "Jalankan `python scripts/benchmark_phase3.py` untuk menghasilkan laporan telemetri Phase 3.",
        }
    data = json.loads(results_file.read_text(encoding="utf-8"))
    if not include_samples and isinstance(data, dict):
        data = {k: v for k, v in data.items() if k != "samples"}
    return {"available": True, **data}
