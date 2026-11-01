from pathlib import Path
from typing import Optional

from app.config import BASE_DIR
from app.models import DetectedLogo, Phase1ScanResponse, Phase2ScanResponse
from app.sandbox.browser import HeadlessSandboxScanner
from app.supabase_client import SupabaseService
from app.vision.logo_detector import detect_and_annotate_logos
from app.vision.similarity import compute_visual_similarity

STORAGE_DIR = BASE_DIR / "storage"
scanner = HeadlessSandboxScanner(base_storage_dir=STORAGE_DIR)


async def execute_phase1_scan(
    target_url: str,
    scan_id: Optional[str] = None,
) -> Phase1ScanResponse:
    return await scanner.capture_and_extract(
        target_url=target_url,
        scan_id=scan_id,
    )


async def execute_phase2_scan(
    target_url: str,
    scan_id: Optional[str] = None,
    reporter_source: str = "WEB_SANDBOX",
    reporter_unit: str = "Simulasi Juri / Satuan Jajaran",
) -> Phase2ScanResponse:
    """
    Full Phase 1 + Phase 2 Sandbox, SSIM Visual Similarity, Multi-Scale Logo
    Detection, Weighted Risk Scoring, and automatic Supabase Realtime Sync.
    """
    p1 = await scanner.capture_and_extract(
        target_url=target_url,
        scan_id=scan_id,
    )

    screenshot_abs: Path = BASE_DIR / p1.screenshot_path
    annotated_abs: Path = BASE_DIR / p1.annotated_dom_path

    # 1. Compute SSIM + Visual Layout Similarity against Reference DB
    sim_result = compute_visual_similarity(screenshot_abs)
    visual_score = float(sim_result["visual_similarity_score"] or 0.0)
    impersonated_target = sim_result["impersonated_target"]

    # 2. Detect & Annotate TNI AD / Kartika Eka Paksi / Kemhan / Seskoad Logos
    raw_logos = detect_and_annotate_logos(
        screenshot_path=screenshot_abs,
        annotated_path=annotated_abs,
        dom_images=p1.images,
    )
    detected_logos = [DetectedLogo(**lg) for lg in raw_logos]

    # Boost visual score if an official military logo is explicitly detected on a non-official host
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

    # 4. Upload evidence screenshots to Supabase Storage (or fallback local static URLs)
    captured_url = await SupabaseService.upload_evidence_image(
        local_file=screenshot_abs,
        remote_object_path=f"screenshots/{screenshot_abs.name}",
        fallback_static_subpath=f"static/screenshots/{screenshot_abs.name}",
    )
    annotated_url = await SupabaseService.upload_evidence_image(
        local_file=annotated_abs,
        remote_object_path=f"annotated/{annotated_abs.name}",
        fallback_static_subpath=f"static/annotated/{annotated_abs.name}",
    )

    # 5. Persist incident to Supabase `scan_incidents` for Realtime SOC Dashboard
    dom_findings = {
        "final_url": p1.final_url,
        "page_title": p1.page_title,
        "status_code": p1.status_code,
        "redirect_chain": p1.redirect_chain,
        "forms": [f.model_dump() for f in p1.forms],
        "sensitive_inputs": [i.model_dump() for i in p1.inputs if i.is_sensitive_credential],
        "detected_military_keywords": p1.detected_military_keywords,
        "external_domains_contacted": p1.external_domains_contacted,
        "forensic_reasons": p1.risk_analysis.forensic_reasons,
    }

    synced, incident_id = await SupabaseService.record_scan_incident(
        submitted_url=p1.initial_url,
        reporter_source=reporter_source,
        reporter_unit=reporter_unit,
        total_risk_score=total_risk,
        visual_similarity_score=visual_score,
        dom_anomaly_score=p1.risk_analysis.dom_anomaly_score,
        domain_telemetry_score=p1.risk_analysis.domain_telemetry_score,
        verdict=verdict,
        impersonated_target=str(impersonated_target) if impersonated_target else None,
        captured_screenshot_url=captured_url,
        annotated_bbox_url=annotated_url,
        detected_logos=[lg.model_dump() for lg in detected_logos],
        dom_findings=dom_findings,
    )

    return Phase2ScanResponse(
        **p1.model_dump(),
        verdict=verdict,
        total_risk_score=total_risk,
        visual_similarity_score=visual_score,
        impersonated_target=str(impersonated_target) if impersonated_target else None,
        detected_logos=detected_logos,
        captured_screenshot_url=captured_url,
        annotated_bbox_url=annotated_url,
        supabase_synced=synced,
        supabase_incident_id=incident_id,
    )

