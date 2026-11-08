import asyncio
import base64
import re
import shutil
import time
import uuid
from pathlib import Path
from typing import Optional
from urllib.parse import unquote

import cv2
import httpx
import numpy as np

from app import domain_guard, scoring, security
from app.config import BASE_DIR
from app.models import (
    DecodedQRCode,
    DetectedLogo,
    ImageScanResponse,
    Phase1ScanResponse,
    Phase2ScanResponse,
)
from app.sandbox.annotator import _draw_label_badge
from app.sandbox.browser import HeadlessSandboxScanner
from app.supabase_client import SupabaseService
from app.vision.image_analyzer import COLOR_VISUAL_INPUT_AMBER, analyze_image_semantics
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
BARE_HOST_IN_TEXT_REGEX = re.compile(
    r"\b(?:www\.[a-z0-9-]+(?:\.[a-z0-9-]+)+|[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:mil\.id|go\.id|ac\.id|co\.id|com|net|org|id|xyz|info|site|online|top|link|click|vip|icu|me|io|app|pages\.dev|vercel\.app|ngrok-free\.app|trycloudflare\.com|ly))(?:/[^\s<>\"']*)?",
    re.IGNORECASE,
)

# Passive official social media hosts commonly printed in official TNI/government poster/portal footers
_PASSIVE_SOCIAL_HOSTS: frozenset[str] = frozenset(
    {
        "instagram.com",
        "facebook.com",
        "fb.com",
        "youtube.com",
        "youtu.be",
        "twitter.com",
        "x.com",
        "tiktok.com",
    }
)


def _is_passive_social_ocr_url(url_str: str) -> bool:
    host = domain_guard.parse_url(url_str)[1]
    if not host:
        return False
    return any(host == s or host.endswith("." + s) for s in _PASSIVE_SOCIAL_HOSTS)


def _evaluate_extracted_url_telemetry(
    url_str: str,
    *,
    military_context: bool = False,
) -> tuple[float, bool, list[str]]:
    """Evaluate domain telemetry risk for a URL extracted from a QR code, OCR text, or image caption."""
    assessment = domain_guard.assess_url(url_str, military_context=military_context)
    if not assessment.host:
        return 0.0, False, []
    return assessment.risk_score, assessment.is_official, assessment.reasons


def _extract_urls_from_caption(caption: str) -> list[str]:
    if not caption:
        return []
    urls: list[str] = []
    for m in URL_IN_TEXT_REGEX.findall(caption):
        clean_u = m.rstrip(".,);]*_!?'\"")
        if clean_u not in urls:
            urls.append(clean_u)
    for m in BARE_HOST_IN_TEXT_REGEX.findall(caption):
        clean_b = m.rstrip(".,);]*_!?'\"")
        norm_b = clean_b if "://" in clean_b else f"https://{clean_b}"
        if not any(clean_b.lower() in ex.lower() for ex in urls):
            urls.append(norm_b)
    return urls


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
        if u.startswith("http://") or u.startswith("https://"):
            async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
                resp = await client.get(u)
                resp.raise_for_status()
                raw_bytes = resp.content
        else:
            raw_bytes = security.resolve_local_image_path(unquote(u)).read_bytes()

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
    Detection, Context-Aware Risk Scoring (Military + General Web), and Supabase Sync.
    """
    t_total0 = time.perf_counter()
    p1 = await scanner.capture_and_extract(
        target_url=target_url,
        scan_id=scan_id,
    )

    screenshot_abs: Path = BASE_DIR / p1.screenshot_path
    annotated_abs: Path = BASE_DIR / p1.annotated_dom_path

    # 1. Compute SSIM + Edge + Palette Visual Similarity against Reference DB
    #    (Skip visual/logo matching if status_code == 504 diagnostic telemetry canvas)
    is_unreachable_fallback = p1.status_code == 504
    t_sim0 = time.perf_counter()
    if is_unreachable_fallback:
        visual_score = 0.0
        impersonated_target = None
        visual_similarity_ms = 0.0
    else:
        sim_result = compute_visual_similarity(screenshot_abs)
        visual_similarity_ms = round((time.perf_counter() - t_sim0) * 1000.0, 2)
        visual_score = float(sim_result["visual_similarity_score"] or 0.0)
        impersonated_target = sim_result["impersonated_target"]

    # 2. Detect & Annotate TNI AD / Kartika Eka Paksi / Kemhan / Kotama Logos
    t_logo0 = time.perf_counter()
    if is_unreachable_fallback:
        raw_logos = []
        logo_detection_ms = 0.0
    else:
        raw_logos = detect_and_annotate_logos(
            screenshot_path=screenshot_abs,
            annotated_path=annotated_abs,
            dom_images=p1.images,
        )
        logo_detection_ms = round((time.perf_counter() - t_logo0) * 1000.0, 2)
    detected_logos = [DetectedLogo(**lg) for lg in raw_logos]

    t_fuse0 = time.perf_counter()
    has_mil_context = bool(detected_logos or p1.detected_military_keywords or visual_score >= 55.0)

    if detected_logos and not p1.risk_analysis.is_official_mil_domain:
        top_logo_conf = max(lg.confidence for lg in detected_logos)
        visual_score = round(max(visual_score, top_logo_conf), 2)
        if not impersonated_target:
            impersonated_target = detected_logos[0].brand_name
        p1.risk_analysis.forensic_reasons.append(
            f"Impersonated military emblem detected: {detected_logos[0].brand_name} ({top_logo_conf:.1f}% confidence)"
        )
    elif not p1.risk_analysis.is_official_mil_domain and not has_mil_context:
        impersonated_target = None

    # 3. VisiKartika Shield Weighted Risk Formula: 45% Visual + 30% DOM + 25% Domain
    decision = scoring.fuse_url_scan(
        visual=visual_score,
        dom=p1.risk_analysis.dom_anomaly_score,
        domain=p1.risk_analysis.domain_telemetry_score,
        is_official_domain=p1.risk_analysis.is_official_mil_domain,
        has_cross_origin_form=any(f.is_cross_origin for f in p1.forms),
        has_official_logo=bool(detected_logos),
        has_credential_harvesting=p1.risk_analysis.has_credential_harvesting,
        has_generic_phishing_infra=(p1.risk_analysis.domain_telemetry_score >= 45.0),
    )
    if (
        is_unreachable_fallback
        and not p1.risk_analysis.is_official_mil_domain
        and p1.risk_analysis.domain_telemetry_score >= 55.0
    ):
        tel_floor = round(min(88.0, p1.risk_analysis.domain_telemetry_score), 2)
        if decision.total_risk_score < tel_floor:
            decision.total_risk_score = tel_floor
            decision.verdict = scoring.classify(tel_floor)
            decision.applied_rules.append(
                f"UNREACHABLE_HIGH_RISK_DOMAIN: host timeout/tidak aktif namun telemetri domain berisiko tinggi (skor min {tel_floor:.0f})"
            )
    total_risk = decision.total_risk_score
    verdict = decision.verdict

    if p1.risk_analysis.is_official_mil_domain and verdict == "SAFE":
        content_category = "OFFICIAL_MILITARY"
    elif verdict in ("CRITICAL_PHISHING", "SUSPICIOUS"):
        content_category = "MILITARY_PHISHING" if has_mil_context else "GENERIC_PHISHING"
    else:
        content_category = "GENERAL_WEB_SAFE"
        if not p1.risk_analysis.forensic_reasons:
            p1.risk_analysis.forensic_reasons.append(
                "Situs web umum non-militer dengan protokol HTTPS standar; tidak ditemukan pencatutan atribut TNI AD maupun eksfiltrasi kredensial."
            )
    scoring_fusion_ms = round((time.perf_counter() - t_fuse0) * 1000.0, 2)

    # 4. Upload evidence screenshots to Supabase Storage in parallel (or fallback local static URLs)
    t_sb0 = time.perf_counter()
    if SupabaseService.is_configured():
        captured_url, annotated_url = await asyncio.gather(
            SupabaseService.upload_evidence_image(
                local_file=screenshot_abs,
                remote_object_path=f"screenshots/{screenshot_abs.name}",
                fallback_static_subpath=f"static/screenshots/{screenshot_abs.name}",
            ),
            SupabaseService.upload_evidence_image(
                local_file=annotated_abs,
                remote_object_path=f"annotated/{annotated_abs.name}",
                fallback_static_subpath=f"static/annotated/{annotated_abs.name}",
            ),
        )
    else:
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

    total_elapsed_sec = round(time.perf_counter() - t_total0, 3)
    latency_breakdown = dict(p1.latency_breakdown_ms)
    latency_breakdown.update(
        {
            "visual_similarity_ms": visual_similarity_ms,
            "logo_detection_ms": logo_detection_ms,
            "scoring_fusion_ms": scoring_fusion_ms,
        }
    )

    # 5. Persist incident to Supabase `scan_incidents` for Realtime SOC Dashboard
    dom_findings = {
        "final_url": p1.final_url,
        "page_title": p1.page_title,
        "content_category": content_category,
        "status_code": p1.status_code,
        "redirect_chain": p1.redirect_chain,
        "forms": [f.model_dump() for f in p1.forms],
        "sensitive_inputs": [i.model_dump() for i in p1.inputs if i.is_sensitive_credential],
        "detected_military_keywords": p1.detected_military_keywords,
        "external_domains_contacted": p1.external_domains_contacted,
        "forensic_reasons": p1.risk_analysis.forensic_reasons,
        "risk_fusion": decision.as_dict(),
        "latency_breakdown_ms": latency_breakdown,
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
    supabase_sync_ms = round((time.perf_counter() - t_sb0) * 1000.0, 2)
    total_elapsed_sec = round(time.perf_counter() - t_total0, 3)
    latency_breakdown["supabase_sync_ms"] = supabase_sync_ms
    latency_breakdown["total_ms"] = round(total_elapsed_sec * 1000.0, 2)

    p1_payload = p1.model_dump()
    p1_payload["execution_time_sec"] = total_elapsed_sec
    p1_payload["latency_breakdown_ms"] = latency_breakdown

    return Phase2ScanResponse(
        **p1_payload,
        verdict=verdict,
        content_category=content_category,
        total_risk_score=total_risk,
        visual_similarity_score=visual_score,
        impersonated_target=str(impersonated_target) if impersonated_target else None,
        detected_logos=detected_logos,
        captured_screenshot_url=captured_url,
        annotated_bbox_url=annotated_url,
        supabase_synced=synced,
        supabase_incident_id=incident_id,
        applied_rules=decision.applied_rules,
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
    Multimodal Poster, Screenshot & QR Quishing Analyzer:
      1. Layout & Aspect-Ratio Classification (`POSTER_FLYER`, `MOBILE_SCREENSHOT`, `WEB_SCREENSHOT`)
      2. OCR Text Extraction (printed URLs, military terms, calo/fee scams, APK malware, login cues)
      3. Visual Input-Box Detection (for static login screenshots without HTML DOM)
      4. Full-Canvas Multi-Scale Logo Detection & QR Code Quishing Decoding
      5. Context-Aware Risk Fusion (distinguishes fake posters/phishing from official TNI graphics & safe general non-TNI web/posters).
    """
    t0 = time.perf_counter()
    resolved_id = (scan_id or f"img_{uuid.uuid4().hex[:10]}").strip()

    screenshot_abs = SCREENSHOTS_DIR / f"{resolved_id}.png"
    annotated_abs = ANNOTATED_DIR / f"{resolved_id}_dom.png"

    t_io0 = time.perf_counter()
    source_label = await _load_image_to_path(
        dest_png_path=screenshot_abs,
        image_bytes=image_bytes,
        image_url=image_url,
        image_base64=image_base64,
    )
    shutil.copyfile(screenshot_abs, annotated_abs)
    decode_io_ms = round((time.perf_counter() - t_io0) * 1000.0, 2)

    forensic_reasons: list[str] = []

    # 1. Visual Layout Similarity against Official Portals (Active-Region + Edge + HSV + Aspect Guard)
    t_sim0 = time.perf_counter()
    sim_result = compute_visual_similarity(screenshot_abs)
    visual_similarity_ms = round((time.perf_counter() - t_sim0) * 1000.0, 2)
    layout_similarity = float(sim_result["visual_similarity_score"] or 0.0)
    impersonated_target = sim_result["impersonated_target"]

    # 2. Multimodal Layout, Visual Input Box & OCR Semantic Analysis
    t_sem0 = time.perf_counter()
    sem = analyze_image_semantics(screenshot_abs, annotated_path=None, annotate_inputs_if_suspicious=False)
    ocr_semantics_ms = round((time.perf_counter() - t_sem0) * 1000.0, 2)

    # 3. Full-Canvas Multi-Scale Logo Detection & Red Bounding Box Annotation
    t_logo0 = time.perf_counter()
    raw_logos = detect_and_annotate_logos(
        screenshot_path=screenshot_abs,
        annotated_path=annotated_abs,
        dom_images=[],
    )
    logo_detection_ms = round((time.perf_counter() - t_logo0) * 1000.0, 2)
    detected_logos = [DetectedLogo(**lg) for lg in raw_logos]

    # 4. QR Code Quishing Detection & Magenta Bounding Box Annotation
    t_qr0 = time.perf_counter()
    raw_qrs = detect_and_annotate_qr_codes(
        image_path=screenshot_abs,
        annotated_path=annotated_abs,
    )
    qr_quishing_ms = round((time.perf_counter() - t_qr0) * 1000.0, 2)
    decoded_qrs = [DecodedQRCode(**q) for q in raw_qrs]

    t_fuse0 = time.perf_counter()
    # 5. Consolidate URLs from QR payloads, caption text, and OCR text (filtering passive social footer links from OCR)
    extracted_urls: list[str] = []
    for qr in decoded_qrs:
        forensic_reasons.append(f"Terdeteksi kode QR di dalam gambar: '{qr.payload}'")
        if "." in qr.payload or "://" in qr.payload:
            extracted_urls.append(qr.payload)

    if caption:
        for cap_u in _extract_urls_from_caption(caption):
            if not any(cap_u.lower() == ex.lower() for ex in extracted_urls):
                extracted_urls.append(cap_u)

    for ocr_u in sem.ocr_urls:
        if _is_passive_social_ocr_url(ocr_u):
            continue
        if not any(ocr_u.lower() == ex.lower() for ex in extracted_urls):
            extracted_urls.append(ocr_u)

    caption_lower = (caption or "").lower()
    caption_has_mil = bool(domain_guard.find_bait_tokens(caption_lower))
    has_mil_identity = bool(detected_logos or sem.has_military_context or caption_has_mil or layout_similarity >= 68.0)

    # Evaluate all extracted URLs
    official_url_count = 0
    has_high_risk_url = False
    max_dom_tel = 0.0
    url_reasons: list[str] = []

    for u in extracted_urls:
        u_score, is_off, u_rs = _evaluate_extracted_url_telemetry(u, military_context=has_mil_identity)
        non_mil_assess = domain_guard.assess_url(u, military_context=False)
        if non_mil_assess.has_phishing_indicators or non_mil_assess.risk_score >= 45.0:
            has_high_risk_url = True
        max_dom_tel = max(max_dom_tel, u_score)
        if is_off:
            official_url_count += 1
        for r in u_rs:
            if r not in url_reasons:
                url_reasons.append(r)

    all_urls_official = bool(extracted_urls) and (official_url_count == len(extracted_urls))
    non_official_urls = [u for u in extracted_urls if not domain_guard.is_official_domain(u)]

    # Explicit credential harvesting cue vs incidental single search bar on an official homepage
    has_explicit_cred_harvesting = bool(
        "password/kata sandi" in sem.login_cues or "identitas NRP/NIK" in sem.login_cues
    )

    # Check if this is an unmodified capture of a verified official portal homepage:
    # - >=95.5% exact visual match to a registered reference portal (even if that official homepage contains a login widget), OR
    # - >=92.5% visual match with no explicit password/NRP harvesting cues.
    is_pure_official_homepage_capture = bool(
        (layout_similarity >= 95.5 or (layout_similarity >= 92.5 and not has_explicit_cred_harvesting))
        and not decoded_qrs
        and not non_official_urls
        and not sem.scam_indicators
        and not sem.has_personal_wa_contact
    )

    has_login_or_inputs = bool(
        not is_pure_official_homepage_capture
        and (
            sem.has_login_form_cues
            or (has_mil_identity and len(sem.visual_input_boxes) >= 1 and sem.layout_type != "POSTER_FLYER")
        )
    )

    # Annotate visual input boxes in amber ONLY when the screenshot is suspicious (never on clean general logins)
    should_annotate_inputs = bool(
        sem.visual_input_boxes
        and not all_urls_official
        and not is_pure_official_homepage_capture
        and (has_mil_identity or bool(sem.scam_indicators) or has_high_risk_url)
    )
    if should_annotate_inputs:
        ann_img = cv2.imread(str(annotated_abs))
        if ann_img is not None:
            for idx, b in enumerate(sem.visual_input_boxes[:4], start=1):
                x1, y1 = b["x"], b["y"]
                x2, y2 = x1 + b["width"], y1 + b["height"]
                cv2.rectangle(ann_img, (x1, y1), (x2, y2), COLOR_VISUAL_INPUT_AMBER, thickness=2)
                if idx == 1:
                    _draw_label_badge(ann_img, "VISUAL UI: FORM INPUT LOGIN", x1, y1, COLOR_VISUAL_INPUT_AMBER)
            cv2.imwrite(str(annotated_abs), ann_img)

    has_threat_signal = bool(
        sem.scam_indicators
        or has_high_risk_url
        or (
            has_mil_identity
            and not all_urls_official
            and not is_pure_official_homepage_capture
            and (
                bool(decoded_qrs)
                or bool(non_official_urls)
                or has_login_or_inputs
                or sem.has_personal_wa_contact
            )
        )
    )

    visual_score = layout_similarity
    if is_pure_official_homepage_capture:
        visual_score = round(min(layout_similarity, 25.0), 2)
        forensic_reasons.append(
            f"Tampilan sesuai beranda portal informasi resmi ({impersonated_target}) tanpa formulir pencurian kredensial atau tautan eksternal."
        )
    elif detected_logos:
        top_logo_conf = max(lg.confidence for lg in detected_logos)
        unique_brands = list(dict.fromkeys(lg.brand_name for lg in detected_logos))
        brands_label = ", ".join(unique_brands)
        if has_threat_signal:
            visual_score = round(max(visual_score, top_logo_conf), 2)
            if not impersonated_target:
                impersonated_target = detected_logos[0].brand_name
            forensic_reasons.append(
                f"Terdeteksi pencatutan lambang resmi militer pada konten berisiko: {brands_label} ({top_logo_conf:.1f}% confidence)"
            )
        else:
            forensic_reasons.append(
                f"Terdeteksi atribut resmi militer ({brands_label}, puncak {top_logo_conf:.1f}% confidence) dalam konteks publikasi informatif/komemoratif tanpa tautan berbahaya maupun permintaan kredensial."
            )

    if not has_mil_identity:
        impersonated_target = None

    forensic_reasons.extend(url_reasons)

    if sem.scam_indicators:
        forensic_reasons.append(
            f"Terdeteksi teks indikasi penipuan/pungli melalui OCR: {', '.join(sem.scam_indicators)}"
        )
    if has_mil_identity and sem.has_personal_wa_contact and not all_urls_official:
        forensic_reasons.append(
            "Poster/gambar atribut militer mengarahkan pendaftaran ke nomor telepon/WhatsApp pribadi (indikasi calo rekrutmen)"
        )
    if has_mil_identity and has_login_or_inputs and not all_urls_official:
        forensic_reasons.append(
            f"Tangkapan layar menampilkan antarmuka login/input data ({len(sem.visual_input_boxes)} kolom visual) bermuatan atribut militer tanpa domain resmi .mil.id"
        )
    if sem.has_official_free_disclaimer and not sem.scam_indicators:
        forensic_reasons.append(
            "Terdapat keterangan resmi pendaftaran gratis / tidak dipungut biaya pada gambar"
        )

    # 6. Compute Component Scores (DOM/UI Anomaly & Domain Telemetry)
    if extracted_urls:
        domain_score = max_dom_tel
        if all_urls_official and not sem.scam_indicators and not sem.has_personal_wa_contact:
            dom_score = 0.0
        elif sem.scam_indicators:
            dom_score = 92.0
        elif decoded_qrs and (has_mil_identity or has_high_risk_url):
            dom_score = 88.0
            forensic_reasons.append(
                "Poster/gambar menyisipkan QR Code menuju domain tidak terverifikasi (Indikasi Quishing)"
            )
        elif has_mil_identity and non_official_urls:
            dom_score = 82.0
            forensic_reasons.append(
                f"Tautan pada poster/tangkapan layar militer mengarah ke luar namespace resmi .mil.id ({non_official_urls[0]})"
            )
        elif has_login_or_inputs and has_high_risk_url:
            dom_score = 78.0
            forensic_reasons.append(
                "Tangkapan layar form login mengarah ke domain berisiko tinggi (Indikasi Phishing Umum)"
            )
        else:
            dom_score = 12.0
            forensic_reasons.append(
                "Konten umum non-militer dengan tautan standar; tidak ditemukan indikator phishing maupun pencatutan atribut TNI AD."
            )
    else:
        if sem.scam_indicators:
            dom_score = 90.0
            domain_score = 75.0
        elif has_mil_identity and has_login_or_inputs:
            dom_score = 85.0
            domain_score = 75.0
        elif has_mil_identity and sem.has_personal_wa_contact:
            dom_score = 78.0
            domain_score = 70.0
        elif has_mil_identity:
            dom_score = 10.0
            domain_score = 10.0
            if not forensic_reasons:
                forensic_reasons.append(
                    "Publikasi/poster kegiatan militer informatif tanpa tautan eksternal berbahaya, QR quishing, maupun formulir kredensial."
                )
        else:
            dom_score = 10.0
            domain_score = 12.0
            forensic_reasons.append(
                f"Gambar diklasifikasikan sebagai {sem.layout_type} umum non-militer; tidak ditemukan indikasi phishing, malware, maupun pencatutan lambang TNI AD."
            )

    decision = scoring.fuse_image_scan(
        visual=visual_score,
        dom=dom_score,
        domain=domain_score,
        has_official_logo=bool(detected_logos) and not is_pure_official_homepage_capture,
        has_qr_code=bool(decoded_qrs),
        extracted_urls_total=len(extracted_urls),
        extracted_urls_official=official_url_count,
        has_military_context=has_mil_identity and not is_pure_official_homepage_capture,
        has_scam_text=bool(sem.scam_indicators),
        has_login_form_cues=has_login_or_inputs,
        has_personal_contact=sem.has_personal_wa_contact,
        has_high_risk_url=has_high_risk_url,
    )
    total_risk = decision.total_risk_score
    verdict = decision.verdict

    is_poster = sem.layout_type == "POSTER_FLYER" or bool(decoded_qrs)
    if verdict in ("CRITICAL_PHISHING", "SUSPICIOUS"):
        if is_poster:
            content_category = "POSTER_SCAM" if has_mil_identity else "GENERIC_PHISHING"
        else:
            content_category = "MILITARY_PHISHING" if has_mil_identity else "GENERIC_PHISHING"
    else:
        if has_mil_identity or all_urls_official or is_pure_official_homepage_capture:
            content_category = "POSTER_OFFICIAL_MILITARY" if is_poster else "OFFICIAL_MILITARY"
        else:
            content_category = "POSTER_GENERAL_SAFE" if is_poster else "GENERAL_WEB_SAFE"
    scoring_fusion_ms = round((time.perf_counter() - t_fuse0) * 1000.0, 2)

    # 8. Upload Raw & Annotated Images to Supabase Storage (`scan-evidence`) in parallel
    t_sb0 = time.perf_counter()
    if SupabaseService.is_configured():
        captured_url, annotated_url = await asyncio.gather(
            SupabaseService.upload_evidence_image(
                local_file=screenshot_abs,
                remote_object_path=f"screenshots/{screenshot_abs.name}",
                fallback_static_subpath=f"static/screenshots/{screenshot_abs.name}",
            ),
            SupabaseService.upload_evidence_image(
                local_file=annotated_abs,
                remote_object_path=f"annotated/{annotated_abs.name}",
                fallback_static_subpath=f"static/annotated/{annotated_abs.name}",
            ),
        )
    else:
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

    ocr_snippet = " ".join(sem.ocr_text.split())[:240] if sem.ocr_text else None
    submitted_target = extracted_urls[0] if extracted_urls else f"[IMAGE:{sem.layout_type}] {source_label}"
    latency_breakdown = {
        "decode_io_ms": decode_io_ms,
        "visual_similarity_ms": visual_similarity_ms,
        "ocr_semantics_ms": ocr_semantics_ms,
        "logo_detection_ms": logo_detection_ms,
        "qr_quishing_ms": qr_quishing_ms,
        "scoring_fusion_ms": scoring_fusion_ms,
    }
    dom_findings = {
        "scan_mode": "MULTIMODAL_IMAGE_OCR_QUISHING",
        "source_image": source_label,
        "layout_type": sem.layout_type,
        "content_category": content_category,
        "caption": caption,
        "ocr_text_snippet": ocr_snippet,
        "visual_input_boxes_count": len(sem.visual_input_boxes),
        "decoded_qr_codes": [q.model_dump() for q in decoded_qrs],
        "extracted_urls": extracted_urls,
        "forensic_reasons": forensic_reasons,
        "risk_fusion": decision.as_dict(),
        "latency_breakdown_ms": latency_breakdown,
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
    supabase_sync_ms = round((time.perf_counter() - t_sb0) * 1000.0, 2)
    elapsed = round(time.perf_counter() - t0, 3)
    latency_breakdown["supabase_sync_ms"] = supabase_sync_ms
    latency_breakdown["total_ms"] = round(elapsed * 1000.0, 2)

    return ImageScanResponse(
        success=True,
        scan_id=resolved_id,
        source_image=source_label,
        verdict=verdict,
        content_category=content_category,
        layout_type=sem.layout_type,
        total_risk_score=total_risk,
        visual_similarity_score=visual_score,
        dom_anomaly_score=dom_score,
        domain_telemetry_score=domain_score,
        impersonated_target=str(impersonated_target) if impersonated_target else None,
        detected_logos=detected_logos,
        decoded_qr_codes=decoded_qrs,
        extracted_urls=extracted_urls,
        ocr_text_snippet=ocr_snippet,
        visual_input_boxes_count=len(sem.visual_input_boxes),
        forensic_reasons=forensic_reasons,
        screenshot_path=f"storage/screenshots/{screenshot_abs.name}",
        annotated_dom_path=f"storage/annotated/{annotated_abs.name}",
        captured_screenshot_url=captured_url,
        annotated_bbox_url=annotated_url,
        supabase_synced=synced,
        supabase_incident_id=incident_id,
        applied_rules=decision.applied_rules,
        execution_time_sec=elapsed,
        latency_breakdown_ms=latency_breakdown,
    )
