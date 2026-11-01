import base64
import re
import shutil
import time
import uuid
from pathlib import Path
from typing import Optional
from urllib.parse import unquote, urlparse

import cv2
import httpx
import numpy as np

from app.config import BASE_DIR
from app.models import (
    DecodedQRCode,
    DetectedLogo,
    ImageScanResponse,
    Phase1ScanResponse,
    Phase2ScanResponse,
)
from app.sandbox.browser import HeadlessSandboxScanner, OFFICIAL_MIL_DOMAINS
from app.supabase_client import SupabaseService
from app.vision.logo_detector import detect_and_annotate_logos
from app.vision.ocr_quishing import detect_and_annotate_qr_codes
from app.vision.similarity import compute_visual_similarity

STORAGE_DIR = BASE_DIR / "storage"
SCREENSHOTS_DIR = STORAGE_DIR / "screenshots"
ANNOTATED_DIR = STORAGE_DIR / "annotated"
SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)
ANNOTATED_DIR.mkdir(parents=True, exist_ok=True)

scanner = HeadlessSandboxScanner(base_storage_dir=STORAGE_DIR)

URL_IN_TEXT_REGEX = re.compile(r"https?://[^\s<>\"']+", re.IGNORECASE)


def _evaluate_extracted_url_telemetry(url_str: str) -> tuple[float, bool, list[str]]:
    """Evaluate domain telemetry risk for a URL extracted from a QR code or image caption."""
    parsed = urlparse(url_str if "://" in url_str else f"https://{url_str}")
    host = (parsed.hostname or "").lower()
    if not host:
        return 0.0, False, []

    is_official = any(host == d or host.endswith("." + d) for d in OFFICIAL_MIL_DOMAINS)
    if is_official:
        return 0.0, True, [f"Domain resmi terverifikasi: {host}"]

    reasons: list[str] = []
    score = 55.0
    reasons.append(f"Tautan mengarah ke domain eksternal non-militer: '{host}'")

    mil_bait = ("tni", "kartika", "pussiber", "bintara", "tamtama", "sisfopers", "kemhan", "mil-id", "rekrutmen", "panpus")
    if any(k in host for k in mil_bait):
        score += 35.0
        reasons.append(f"Indikasi typosquatting / penyamaran nama institusi militer pada domain '{host}'")

    if parsed.scheme != "https":
        score += 10.0
        reasons.append("Tautan tidak menggunakan enkripsi HTTPS standar")

    return min(100.0, score), False, reasons


async def _load_image_to_path(
    *,
    dest_png_path: Path,
    image_bytes: Optional[bytes] = None,
    image_url: Optional[str] = None,
    image_base64: Optional[str] = None,
) -> str:
    """Resolve raw image bytes, base64, local path, or remote URL and save as PNG."""
    raw_bytes: Optional[bytes] = image_bytes
    source_label = "uploaded_image.png"

    if raw_bytes is None and image_base64:
        b64_clean = image_base64.split(",")[-1].strip()
        raw_bytes = base64.b64decode(b64_clean)
        source_label = "base64_image.png"

    if raw_bytes is None and image_url:
        u = image_url.strip()
        source_label = u
        if u.startswith("file://"):
            parsed = urlparse(u)
            local_p = Path(unquote(parsed.path.lstrip("/")) if ":" in parsed.path else unquote(parsed.path))
            raw_bytes = local_p.read_bytes()
        elif u.startswith("http://") or u.startswith("https://"):
            async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
                resp = await client.get(u)
                resp.raise_for_status()
                raw_bytes = resp.content
        else:
            local_p = Path(u)
            if not local_p.is_absolute():
                local_p = BASE_DIR / local_p
            raw_bytes = local_p.read_bytes()

    if not raw_bytes:
        raise ValueError("Tidak ada data gambar yang valid (berikan file, image_url, atau image_base64).")

    arr = np.frombuffer(raw_bytes, dtype=np.uint8)
    img_bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img_bgr is None:
        raise ValueError("Format gambar tidak dapat dibaca oleh OpenCV (pastikan PNG/JPG/WebP valid).")

    cv2.imwrite(str(dest_png_path), img_bgr)
    return source_label


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


async def execute_image_scan(
    *,
    image_bytes: Optional[bytes] = None,
    image_url: Optional[str] = None,
    image_base64: Optional[str] = None,
    caption: Optional[str] = None,
    scan_id: Optional[str] = None,
    reporter_source: str = "WEB_SANDBOX",
    reporter_unit: str = "Simulasi Juri / Satuan Jajaran",
) -> ImageScanResponse:
    """
    Analyze a screenshot or recruitment poster image for:
    1. Visual layout similarity (SSIM + HSV) against official TNI AD / Kemhan portals
    2. Impersonated military logos (Kartika Eka Paksi, Panpus, Kemhan, PUSSIBERAD)
    3. QR Code Quishing payloads (`cv2.QRCodeDetector` + bounding box annotation)
    4. Automatic Supabase Storage (`scan-evidence`) & `scan_incidents` Realtime sync.
    """
    t0 = time.perf_counter()
    resolved_id = (scan_id or f"img_{uuid.uuid4().hex[:10]}").strip()

    screenshot_abs = SCREENSHOTS_DIR / f"{resolved_id}.png"
    annotated_abs = ANNOTATED_DIR / f"{resolved_id}_dom.png"

    source_label = await _load_image_to_path(
        dest_png_path=screenshot_abs,
        image_bytes=image_bytes,
        image_url=image_url,
        image_base64=image_base64,
    )
    shutil.copyfile(screenshot_abs, annotated_abs)

    forensic_reasons: list[str] = []

    # 1. Visual Layout Similarity
    sim_result = compute_visual_similarity(screenshot_abs)
    visual_score = float(sim_result["visual_similarity_score"] or 0.0)
    impersonated_target = sim_result["impersonated_target"]

    # 2. Multi-Scale Logo Detection & Red Bounding Box Annotation
    raw_logos = detect_and_annotate_logos(
        screenshot_path=screenshot_abs,
        annotated_path=annotated_abs,
        dom_images=[],
    )
    detected_logos = [DetectedLogo(**lg) for lg in raw_logos]
    if detected_logos:
        top_logo_conf = max(lg.confidence for lg in detected_logos)
        visual_score = round(max(visual_score, top_logo_conf), 2)
        forensic_reasons.append(
            f"Terdeteksi penggunaan lambang resmi militer pada gambar: {detected_logos[0].brand_name} ({top_logo_conf:.1f}% confidence)"
        )

    # 3. QR Code Quishing Detection & Magenta Bounding Box Annotation
    raw_qrs = detect_and_annotate_qr_codes(
        image_path=screenshot_abs,
        annotated_path=annotated_abs,
    )
    decoded_qrs = [DecodedQRCode(**q) for q in raw_qrs]

    extracted_urls: list[str] = []
    for qr in decoded_qrs:
        forensic_reasons.append(f"Terdeteksi kode QR (Quishing) di dalam gambar: '{qr.payload}'")
        if "." in qr.payload or "://" in qr.payload:
            extracted_urls.append(qr.payload)

    if caption:
        for m in URL_IN_TEXT_REGEX.findall(caption):
            clean_u = m.rstrip(".,);]*_")
            if clean_u not in extracted_urls:
                extracted_urls.append(clean_u)

    # 4. Compute Domain & Visual Form Anomaly Scores
    domain_score = 45.0
    dom_score = 50.0
    any_official_url = False

    if extracted_urls:
        max_dom_tel = 0.0
        for u in extracted_urls:
            u_score, is_off, u_reasons = _evaluate_extracted_url_telemetry(u)
            max_dom_tel = max(max_dom_tel, u_score)
            if is_off:
                any_official_url = True
            forensic_reasons.extend(u_reasons)
        domain_score = max_dom_tel
        if decoded_qrs and not any_official_url:
            dom_score = 85.0
            forensic_reasons.append("Poster/gambar menyisipkan QR Code menuju tautan eksternal non-.mil.id (Indikasi Quishing)")
    else:
        if detected_logos or visual_score >= 65.0:
            dom_score = 75.0
            domain_score = 70.0
            forensic_reasons.append(
                f"Tangkapan layar menyerupai tampilan '{impersonated_target or 'Portal Militer'}' ({visual_score:.1f}%) tanpa verifikasi domain resmi .mil.id"
            )
        else:
            dom_score = 15.0
            domain_score = 15.0
            forensic_reasons.append("Tidak ditemukan QR code berbahaya maupun pencatutan lambang resmi TNI AD pada gambar")

    if any_official_url and not [u for u in extracted_urls if not _evaluate_extracted_url_telemetry(u)[1]]:
        total_risk = 0.0
        verdict = "SAFE"
    else:
        total_risk = round(
            (0.45 * visual_score) + (0.30 * dom_score) + (0.25 * domain_score),
            2,
        )
        if detected_logos and decoded_qrs and not any_official_url:
            total_risk = max(total_risk, 90.0)
        elif detected_logos and visual_score >= 80.0 and not any_official_url:
            total_risk = max(total_risk, 78.0)

        verdict = (
            "CRITICAL_PHISHING"
            if total_risk >= 70.0
            else ("SUSPICIOUS" if total_risk >= 40.0 else "SAFE")
        )

    # 5. Upload Raw & Annotated Images to Supabase Storage (`scan-evidence`)
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

    submitted_target = extracted_urls[0] if extracted_urls else f"[IMAGE] {source_label}"
    dom_findings = {
        "scan_mode": "IMAGE_AND_QUISHING",
        "source_image": source_label,
        "caption": caption,
        "decoded_qr_codes": [q.model_dump() for q in decoded_qrs],
        "extracted_urls": extracted_urls,
        "forensic_reasons": forensic_reasons,
    }

    synced, incident_id = await SupabaseService.record_scan_incident(
        submitted_url=submitted_target,
        reporter_source=reporter_source,
        reporter_unit=reporter_unit,
        total_risk_score=total_risk,
        visual_similarity_score=visual_score,
        dom_anomaly_score=dom_score,
        domain_telemetry_score=domain_score,
        verdict=verdict,
        impersonated_target=str(impersonated_target) if impersonated_target else None,
        captured_screenshot_url=captured_url,
        annotated_bbox_url=annotated_url,
        detected_logos=[lg.model_dump() for lg in detected_logos],
        dom_findings=dom_findings,
    )

    elapsed = round(time.perf_counter() - t0, 3)

    return ImageScanResponse(
        success=True,
        scan_id=resolved_id,
        source_image=source_label,
        verdict=verdict,
        total_risk_score=total_risk,
        visual_similarity_score=visual_score,
        dom_anomaly_score=dom_score,
        domain_telemetry_score=domain_score,
        impersonated_target=str(impersonated_target) if impersonated_target else None,
        detected_logos=detected_logos,
        decoded_qr_codes=decoded_qrs,
        extracted_urls=extracted_urls,
        forensic_reasons=forensic_reasons,
        screenshot_path=f"storage/screenshots/{screenshot_abs.name}",
        annotated_dom_path=f"storage/annotated/{annotated_abs.name}",
        captured_screenshot_url=captured_url,
        annotated_bbox_url=annotated_url,
        supabase_synced=synced,
        supabase_incident_id=incident_id,
        execution_time_sec=elapsed,
    )
