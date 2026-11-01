import asyncio
import sys
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.models import DetectedLogo, Phase1ScanRequest, Phase1ScanResponse, Phase2ScanResponse
from app.sandbox.browser import HeadlessSandboxScanner
from app.vision.logo_detector import detect_and_annotate_logos
from app.vision.similarity import compute_visual_similarity

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


@app.get("/api/v1/reference-portals")
async def list_reference_portals() -> dict[str, object]:
    import json

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


@app.get("/api/v1/mock-targets")
async def list_mock_targets() -> dict[str, object]:
    targets = [
        {
            "filename": p.name,
            "url": f"http://localhost:8000/mock-targets/{p.name}",
        }
        for p in sorted(MOCK_TARGETS_DIR.glob("*.html"))
    ]
    return {"total_targets": len(targets), "targets": targets}


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


@app.post("/api/v1/scan/phase2", response_model=Phase2ScanResponse)
@app.post("/api/v1/scan-url", response_model=Phase2ScanResponse)
async def run_phase2_scan(payload: Phase1ScanRequest) -> Phase2ScanResponse:
    target_url = payload.url.strip()
    if not target_url:
        raise HTTPException(status_code=400, detail="Target URL must not be empty.")

    try:
        p1 = await scanner.capture_and_extract(
            target_url=target_url,
            scan_id=payload.scan_id,
        )

        screenshot_abs = BASE_DIR / p1.screenshot_path
        annotated_abs = BASE_DIR / p1.annotated_dom_path

        # 1. Compute SSIM + Visual Layout Similarity against Reference DB
        sim_result = compute_visual_similarity(screenshot_abs)
        visual_score = float(sim_result["visual_similarity_score"] or 0.0)
        impersonated_target = sim_result["impersonated_target"]

        # 2. Detect & Annotate TNI AD / Kartika Eka Paksi Logos
        raw_logos = detect_and_annotate_logos(
            screenshot_path=screenshot_abs,
            annotated_path=annotated_abs,
            dom_images=p1.images,
        )
        detected_logos = [DetectedLogo(**lg) for lg in raw_logos]

        # Boost visual score if an official military logo is explicitly detected
        if detected_logos and not p1.risk_analysis.is_official_mil_domain:
            top_logo_conf = max(lg.confidence for lg in detected_logos)
            visual_score = round(max(visual_score, top_logo_conf), 2)
            p1.risk_analysis.forensic_reasons.append(
                f"Impersonated military emblem detected: {detected_logos[0].brand_name} ({top_logo_conf:.1f}% confidence)"
            )

        # 3. VisiKartika Shield Weighted Risk Formula: 45% Visual + 30% DOM + 25% Domain
        if p1.risk_analysis.is_official_mil_domain and not any(f.is_cross_origin for f in p1.forms):
            total_risk = 0.0
            verdict = "SAFE"
        else:
            total_risk = round(
                (0.45 * visual_score)
                + (0.30 * p1.risk_analysis.dom_anomaly_score)
                + (0.25 * p1.risk_analysis.domain_telemetry_score),
                2,
            )
            # Identity-Domain Mismatch rule: Official Logo + Non-.mil.id + Credential Harvesting => CRITICAL_PHISHING
            if (
                detected_logos
                and not p1.risk_analysis.is_official_mil_domain
                and p1.risk_analysis.has_credential_harvesting
            ):
                total_risk = max(total_risk, 92.0)

            verdict = (
                "CRITICAL_PHISHING"
                if total_risk >= 70.0
                else ("SUSPICIOUS" if total_risk >= 40.0 else "SAFE")
            )

        return Phase2ScanResponse(
            **p1.model_dump(),
            verdict=verdict,
            total_risk_score=total_risk,
            visual_similarity_score=visual_score,
            impersonated_target=str(impersonated_target) if impersonated_target else None,
            detected_logos=detected_logos,
        )
    except Exception as exc:
        err_msg = str(exc) or repr(exc)
        raise HTTPException(
            status_code=500,
            detail=f"Phase 2 scan failed for '{target_url}': {type(exc).__name__}: {err_msg}",
        ) from exc

