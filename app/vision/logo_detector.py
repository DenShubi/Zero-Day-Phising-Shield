import json
from pathlib import Path
from typing import Optional, Sequence, Union

import cv2
import numpy as np

from app.models import BoundingBox, ImageElement
from app.sandbox.annotator import _draw_label_badge
from app.vision.similarity import compute_ssim_opencv


COLOR_LOGO_CRIMSON = (36, 28, 237)  # High-visibility Red/Crimson for Logo Impersonation

LOGO_LABELS = {
    "kartika": "TNI AD / Kartika Eka Paksi",
    "logo-tni-ad": "TNI Angkatan Darat (Kartika Eka Paksi)",
    "insignia_tniad": "TNI Angkatan Darat (Kartika Eka Paksi)",
    "panpus-logo": "Panpus Penerimaan Prajurit TNI AD",
    "kemhan": "Kementerian Pertahanan RI",
    "logo-seskoad": "SESKOAD TNI Angkatan Darat",
    "rekrutmen-tni": "Portal Rekrutmen TNI",
    "kartika_eka_paksi_crest": "TNI AD / Kartika Eka Paksi",
    "pussiberad_emblem": "PUSSIBERAD TNI AD",
    "garuda_pancasila": "Lambang Negara Garuda Pancasila",
    "mabes_tni": "Markas Besar TNI",
    "kostrad_tniad": "Kostrad TNI AD (Cakra)",
    "kopassus_tniad": "Kopassus TNI AD",
    "kodiklat_tniad": "Kodiklat TNI AD",
    "puspomad_tniad": "Puspomad (Polisi Militer TNI AD)",
    "akmil_magelang": "Akademi Militer (Akmil) TNI AD",
    "pusterad_tniad": "Pusterad TNI AD",
    "secapaad_tniad": "Secapa TNI AD",
    "kodam_jaya": "Kodam Jaya / Jayakarta",
    "kodam_siliwangi": "Kodam III / Siliwangi",
    "kodam_diponegoro": "Kodam IV / Diponegoro",
    "kodam_brawijaya": "Kodam V / Brawijaya",
    "kodam_bukit_barisan": "Kodam I / Bukit Barisan",
    "kodam_sriwijaya": "Kodam II / Sriwijaya",
    "kodam_mulawarman": "Kodam VI / Mulawarman",
    "kodam_udayana": "Kodam IX / Udayana",
    "kodam_hasanuddin": "Kodam XIV / Hasanuddin",
    "kodam_cenderawasih": "Kodam XVII / Cenderawasih",
    "kodam_pattimura": "Kodam XV / Pattimura",
    "kodam_patimura": "Kodam XV / Pattimura",
    "kodam_tanjungpura": "Kodam XII / Tanjungpura",
    "kodam_iskandar_muda": "Kodam Iskandar Muda",
    "kodam_merdeka": "Kodam XIII / Merdeka",
    "kodam_kasuari": "Kodam XVIII / Kasuari",
    "tni_al": "TNI Angkatan Laut (Jalesveva Jayamahe)",
    "tni_au": "TNI Angkatan Udara (Swa Bhuwana Paksa)",
    "unhan_ri": "Universitas Pertahanan RI (Unhan)",
    "bssn_ri": "Badan Siber dan Sandi Negara (BSSN)",
    "lemhannas_ri": "Lemhannas RI",
    "basarnas_ri": "Basarnas RI",
    "bakamla_ri": "Bakamla RI",
}

_COARSE_FACTOR = 0.35
_COARSE_TOP_K = 2
_REFINE_PAD = 8
_SCALES_BANNER: tuple[int, ...] = (28, 36, 46, 60, 78, 102, 134, 175, 224)
_SCALES_FULL: tuple[int, ...] = (28, 36, 46, 60, 78, 102, 134, 175, 224, 280)

_LOGO_TEMPLATE_CACHE: dict[str, tuple[tuple[str, ...], list[dict]]] = {}


def _get_cached_logo_templates(logos_dir: Path) -> list[dict]:
    """Load and cache all `.png` logo templates + pre-built coarse pyramids (auto-invalidating if files change)."""
    if not logos_dir.exists():
        return []
    png_files = sorted(logos_dir.glob("*.png"))
    sig = tuple(f"{p.name}:{p.stat().st_size}" for p in png_files)
    key = str(logos_dir.resolve())
    cached = _LOGO_TEMPLATE_CACHE.get(key)
    if cached is not None and cached[0] == sig:
        return cached[1]

    manifest_labels: dict[str, str] = {}
    for candidate_manifest in (logos_dir / "logos_manifest.json", logos_dir.parent / "logos_manifest.json"):
        if candidate_manifest.exists():
            try:
                data = json.loads(candidate_manifest.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    manifest_labels.update({str(k): str(v) for k, v in data.items()})
            except Exception:
                pass

    loaded_list: list[dict] = []
    for tpl_path in png_files:
        loaded = _load_logo_template(tpl_path, extra_labels=manifest_labels)
        if loaded is not None:
            loaded_list.append(loaded)
    _LOGO_TEMPLATE_CACHE[key] = (sig, loaded_list)
    return loaded_list


def _composite_bgr(bgr: np.ndarray, alpha: np.ndarray, bg_color: np.ndarray) -> np.ndarray:
    a3 = alpha[:, :, None]
    return np.clip(a3 * bgr + (1.0 - a3) * bg_color, 0, 255).astype(np.uint8)


def _load_logo_template(tpl_path: Path, extra_labels: Optional[dict[str, str]] = None) -> Optional[dict]:
    """
    Load a reference logo PNG (supporting RGBA transparency) and precompute
    normalized RGB, alpha mask, HSV histogram, and coarse multi-scale grayscale
    pyramids so per-image template search avoids runtime resize/cvtColor overhead.
    """
    raw = cv2.imread(str(tpl_path), cv2.IMREAD_UNCHANGED)
    if raw is None:
        return None

    orig_h, orig_w = raw.shape[:2]
    max_dim = max(orig_h, orig_w)
    if max_dim > 240:
        scale = 240.0 / float(max_dim)
        new_w = max(24, int(round(orig_w * scale)))
        new_h = max(24, int(round(orig_h * scale)))
        raw = cv2.resize(raw, (new_w, new_h), interpolation=cv2.INTER_AREA)

    if raw.ndim == 3 and raw.shape[2] == 4:
        bgr = raw[:, :, :3]
        alpha = raw[:, :, 3].astype(np.float32) / 255.0
    elif raw.ndim == 3:
        bgr = raw
        alpha = np.ones(raw.shape[:2], dtype=np.float32)
    else:
        bgr = cv2.cvtColor(raw, cv2.COLOR_GRAY2BGR)
        alpha = np.ones(raw.shape[:2], dtype=np.float32)

    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    mask_u8 = (alpha > 0.15).astype(np.uint8) * 255
    hist = cv2.calcHist([hsv], [0, 1], mask_u8, [24, 24], [0, 180, 0, 256])
    cv2.normalize(hist, hist, 0, 1, cv2.NORM_MINMAX)

    th0, tw0 = bgr.shape[:2]
    aspect = float(tw0) / float(max(1, th0))
    is_transparent = float(alpha.mean()) < 0.85

    if is_transparent:
        light_bgr = _composite_bgr(bgr, alpha, np.array([244.0, 244.0, 244.0], dtype=np.float32))
        dark_bgr = _composite_bgr(bgr, alpha, np.array([20.0, 38.0, 20.0], dtype=np.float32))
        base_variants_gray = [
            cv2.cvtColor(light_bgr, cv2.COLOR_BGR2GRAY),
            cv2.cvtColor(dark_bgr, cv2.COLOR_BGR2GRAY),
        ]
    else:
        base_variants_gray = [cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)]

    # Pre-build coarse grayscale pyramid across all scales ONCE at cache load time
    coarse_pyramid: dict[int, tuple[int, list[np.ndarray]]] = {}
    for target_h in _SCALES_FULL:
        target_w = max(20, int(round(target_h * aspect)))
        ch = max(8, int(round(target_h * _COARSE_FACTOR)))
        cw = max(8, int(round(target_w * _COARSE_FACTOR)))
        scaled_grays = [
            cv2.resize(vg, (cw, ch), interpolation=cv2.INTER_AREA)
            for vg in base_variants_gray
        ]
        coarse_pyramid[target_h] = (target_w, scaled_grays)

    brand = LOGO_LABELS.get(tpl_path.stem) or (extra_labels or {}).get(tpl_path.stem) or tpl_path.stem
    return {
        "stem": tpl_path.stem,
        "brand": brand,
        "bgr": bgr,
        "alpha": alpha,
        "hist": hist,
        "aspect": aspect,
        "is_transparent": is_transparent,
        "coarse_pyramid": coarse_pyramid,
    }


def _verify_patch_color_consistency(patch_bgr: np.ndarray, tpl: dict) -> float:
    """
    Verify HSV color histogram correlation over the template's foreground alpha
    mask so random textured photos do not produce false-positive logo matches.
    """
    ph, pw = patch_bgr.shape[:2]
    if ph < 12 or pw < 12:
        return 0.0
    tpl_alpha = cv2.resize(tpl["alpha"], (pw, ph), interpolation=cv2.INTER_LINEAR)
    mask_u8 = (tpl_alpha > 0.18).astype(np.uint8) * 255
    if int(np.count_nonzero(mask_u8)) < 25:
        return 0.5
    patch_hsv = cv2.cvtColor(patch_bgr, cv2.COLOR_BGR2HSV)
    patch_hist = cv2.calcHist([patch_hsv], [0, 1], mask_u8, [24, 24], [0, 180, 0, 256])
    cv2.normalize(patch_hist, patch_hist, 0, 1, cv2.NORM_MINMAX)
    return max(0.0, float(cv2.compareHist(patch_hist, tpl["hist"], cv2.HISTCMP_CORREL)))


def _estimate_border_bg(patch_bgr: np.ndarray) -> np.ndarray:
    ph, pw = patch_bgr.shape[:2]
    corners = np.array(
        [
            patch_bgr[0, 0],
            patch_bgr[0, max(0, pw - 1)],
            patch_bgr[max(0, ph - 1), 0],
            patch_bgr[max(0, ph - 1), max(0, pw - 1)],
        ],
        dtype=np.float32,
    )
    return np.median(corners, axis=0)


def _compare_crop_with_template(crop_bgr: np.ndarray, tpl: dict) -> float:
    """
    Compare a cropped DOM `<img>` region against an official logo template,
    compositing transparent RGBA templates onto the crop's border background.
    """
    h, w = crop_bgr.shape[:2]
    tpl_bgr = cv2.resize(tpl["bgr"], (w, h), interpolation=cv2.INTER_AREA)
    if tpl["is_transparent"]:
        tpl_alpha = cv2.resize(tpl["alpha"], (w, h), interpolation=cv2.INTER_LINEAR)
        bg_color = _estimate_border_bg(crop_bgr)
        composited = _composite_bgr(tpl_bgr, tpl_alpha, bg_color)
    else:
        composited = tpl_bgr

    crop_gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)
    comp_gray = cv2.cvtColor(composited, cv2.COLOR_BGR2GRAY)

    res = cv2.matchTemplate(crop_gray, comp_gray, cv2.TM_CCOEFF_NORMED)
    ncc_score = max(0.0, float(res[0, 0]))
    if ncc_score < 0.42:
        return ncc_score * 0.75

    ssim_score = max(0.0, compute_ssim_opencv(crop_gray, comp_gray))
    hist_score = _verify_patch_color_consistency(crop_bgr, tpl)
    structural_peak = max(ssim_score, ncc_score)
    return float((0.75 * structural_peak) + (0.25 * hist_score))


def _bbox_overlap(a: dict, b: dict) -> bool:
    """Return True if two boxes overlap significantly (IoU > 0.35 or >60% contained)."""
    ax1, ay1 = a["x"], a["y"]
    ax2, ay2 = ax1 + a["width"], ay1 + a["height"]
    bx1, by1 = b["x"], b["y"]
    bx2, by2 = bx1 + b["width"], by1 + b["height"]

    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0, ix2 - ix1), max(0, iy2 - iy1)
    inter = float(iw * ih)
    if inter <= 0.0:
        return False
    area_a = float(a["width"] * a["height"])
    area_b = float(b["width"] * b["height"])
    union = area_a + area_b - inter
    iou = inter / union if union > 0.0 else 0.0
    containment = inter / min(area_a, area_b) if min(area_a, area_b) > 0.0 else 0.0
    return iou > 0.35 or containment > 0.60


def _coarse_to_fine_search(
    roi: np.ndarray,
    roi_coarse_gray: np.ndarray,
    tpl: dict,
    scales: Sequence[int],
    img_w: int,
) -> tuple[float, Optional[dict]]:
    """
    Fast pre-cached coarse-to-fine multi-scale search across `roi`.
    Coarse pass uses pre-resized grayscale templates (zero resize/cvtColor per scan),
    and full-resolution refinement adapts dynamically to the local background color.
    """
    roi_h, roi_w = roi.shape[:2]
    rc_h, rc_w = roi_coarse_gray.shape[:2]
    pyramid: dict[int, tuple[int, list[np.ndarray]]] = tpl["coarse_pyramid"]
    hypotheses: list[tuple[float, int, int, int, int]] = []

    for target_h in scales:
        entry = pyramid.get(target_h)
        if entry is None:
            continue
        target_w, scaled_grays = entry
        if target_h >= roi_h or target_w >= img_w:
            continue
        t0 = scaled_grays[0]
        if t0.shape[0] >= rc_h or t0.shape[1] >= rc_w:
            continue
        for t_gray in scaled_grays:
            res = cv2.matchTemplate(roi_coarse_gray, t_gray, cv2.TM_CCOEFF_NORMED)
            _, max_val, _, max_loc = cv2.minMaxLoc(res)
            if max_val >= 0.48:
                x = int(round(max_loc[0] / _COARSE_FACTOR))
                y = int(round(max_loc[1] / _COARSE_FACTOR))
                hypotheses.append((float(max_val), target_h, target_w, x, y))

    if not hypotheses:
        return 0.0, None

    hypotheses.sort(key=lambda hyp: hyp[0], reverse=True)

    best_score = 0.0
    best_box: Optional[dict] = None
    aspect = tpl["aspect"]
    base_bgr = tpl["bgr"]
    base_alpha = tpl["alpha"]
    is_trans = tpl["is_transparent"]

    for _, base_h, _, x, y in hypotheses[:_COARSE_TOP_K]:
        # Refine across micro-scales (0.92x, 1.0x, 1.08x) around the coarse peak
        for micro in (0.92, 1.0, 1.08):
            th = max(20, int(round(base_h * micro)))
            tw = max(20, int(round(th * aspect)))
            if th >= roi_h or tw >= roi_w:
                continue
            x0 = max(0, x - _REFINE_PAD)
            y0 = max(0, y - _REFINE_PAD)
            x1 = min(roi_w, x + tw + _REFINE_PAD)
            y1 = min(roi_h, y + th + _REFINE_PAD)
            window = roi[y0:y1, x0:x1]
            if window.shape[0] < th or window.shape[1] < tw:
                continue

            t_bgr = cv2.resize(base_bgr, (tw, th), interpolation=cv2.INTER_AREA)
            if is_trans:
                t_alpha = cv2.resize(base_alpha, (tw, th), interpolation=cv2.INTER_LINEAR)
                local_bg = _estimate_border_bg(window)
                t_comp = _composite_bgr(t_bgr, t_alpha, local_bg)
            else:
                t_comp = t_bgr

            res = cv2.matchTemplate(window, t_comp, cv2.TM_CCOEFF_NORMED)
            _, max_val, _, max_loc = cv2.minMaxLoc(res)
            if float(max_val) > best_score:
                best_score = float(max_val)
                best_box = {
                    "x": int(x0 + max_loc[0]),
                    "y": int(y0 + max_loc[1]),
                    "width": int(tw),
                    "height": int(th),
                }

    return best_score, best_box


def _sliding_window_banner_search(
    raw_img: np.ndarray,
    templates: Sequence[dict],
    min_score: float = 0.72,
    exhaustive: bool = False,
    full_page: bool = False,
) -> list[dict]:
    """
    Multi-scale sliding-window template search across banner/hero or full poster canvas.
    """
    orig_h, orig_w = raw_img.shape[:2]
    work_scale = 1.0
    work_img = raw_img
    if max(orig_h, orig_w) > 1280:
        work_scale = 1280.0 / float(max(orig_h, orig_w))
        work_img = cv2.resize(
            raw_img,
            (max(64, int(round(orig_w * work_scale))), max(64, int(round(orig_h * work_scale)))),
            interpolation=cv2.INTER_AREA,
        )

    img_h, img_w = work_img.shape[:2]
    roi_h = img_h if full_page else min(img_h, 440)
    roi = work_img[:roi_h, :]
    roi_coarse_gray = cv2.cvtColor(
        cv2.resize(roi, None, fx=_COARSE_FACTOR, fy=_COARSE_FACTOR, interpolation=cv2.INTER_AREA),
        cv2.COLOR_BGR2GRAY,
    )

    scales = _SCALES_FULL if full_page else _SCALES_BANNER
    candidates: list[dict] = []

    for tpl in templates:
        best_tpl_score, best_tpl_box = _coarse_to_fine_search(
            roi, roi_coarse_gray, tpl, scales, img_w
        )

        if best_tpl_box is not None and best_tpl_score >= min_score:
            bx, by, bw, bh = (
                best_tpl_box["x"],
                best_tpl_box["y"],
                best_tpl_box["width"],
                best_tpl_box["height"],
            )
            patch = roi[by : by + bh, bx : bx + bw]
            color_corr = _verify_patch_color_consistency(patch, tpl)
            if best_tpl_score < 0.85 and color_corr < 0.25:
                continue

            if work_scale != 1.0:
                best_tpl_box = {
                    "x": max(0, min(orig_w - 1, int(round(bx / work_scale)))),
                    "y": max(0, min(orig_h - 1, int(round(by / work_scale)))),
                    "width": max(16, int(round(bw / work_scale))),
                    "height": max(16, int(round(bh / work_scale))),
                }

            candidates.append(
                {
                    "brand_name": tpl["brand"],
                    "raw_score": best_tpl_score,
                    "bbox": best_tpl_box,
                }
            )

    return candidates


def detect_and_annotate_logos(
    screenshot_path: Union[str, Path],
    annotated_path: Union[str, Path],
    dom_images: Sequence[ImageElement],
    logos_dir: Optional[Union[str, Path]] = None,
    threshold: float = 0.65,
    full_page_scan: Optional[bool] = None,
) -> list[dict]:
    """
    Detect impersonated TNI AD / Kartika Eka Paksi / Panpus / Kemhan / Kotama logos
    from `app/reference_db/logos/*.png` and draw red bounding boxes on `annotated_path`.
    """
    if logos_dir is None:
        logos_dir = Path(__file__).resolve().parent.parent / "reference_db" / "logos"
    else:
        logos_dir = Path(logos_dir)

    raw_img = cv2.imread(str(screenshot_path))
    ann_img = cv2.imread(str(annotated_path)) if Path(annotated_path).exists() else None
    if raw_img is None:
        return []
    if ann_img is None:
        ann_img = raw_img.copy()

    templates = _get_cached_logo_templates(logos_dir)

    raw_candidates: list[dict] = []
    img_h, img_w = raw_img.shape[:2]

    # Pass 1: Inspect deduplicated logo-proportioned DOM <img> bounding boxes (capped at top 24 header/logo candidates)
    seen_dom_boxes: set[tuple[int, int, int, int]] = set()
    filtered_dom_imgs: list[tuple[int, ImageElement, int, int, int, int]] = []
    for dom_img in dom_images:
        b = dom_img.bbox
        x1 = max(0, min(b.x, img_w - 1))
        y1 = max(0, min(b.y, img_h - 1))
        x2 = max(0, min(b.x + b.width, img_w))
        y2 = max(0, min(b.y + b.height, img_h))
        w = x2 - x1
        h = y2 - y1
        if w < 24 or h < 24:
            continue
        aspect = float(w) / float(h)
        if w > 550 or h > 380 or aspect < 0.45 or aspect > 5.0:
            continue
        key_box = (x1, y1, w, h)
        if key_box in seen_dom_boxes:
            continue
        seen_dom_boxes.add(key_box)
        meta_hint = f"{dom_img.alt or ''} {dom_img.src or ''}".lower()
        priority = 0 if any(k in meta_hint for k in ("logo", "lambang", "crest", "tni", "kemhan", "panpus")) else (1 if y1 < 360 else 2)
        filtered_dom_imgs.append((priority, dom_img, x1, y1, w, h))

    filtered_dom_imgs.sort(key=lambda item: (item[0], item[3]))
    for _, dom_img, x1, y1, w, h in filtered_dom_imgs[:24]:
        crop_bgr = raw_img[y1 : y1 + h, x1 : x1 + w]

        best_conf = 0.0
        best_brand = "TNI AD / Kartika Eka Paksi"

        for tpl in templates:
            score = _compare_crop_with_template(crop_bgr, tpl)
            if score > best_conf:
                best_conf = score
                best_brand = tpl["brand"]

        alt_lower = (dom_img.alt or "").lower()
        if any(k in alt_lower for k in ("kartika", "tni", "pussiberad", "panpus", "kemhan")):
            best_conf = max(best_conf, 0.92)

        if best_conf >= threshold:
            raw_candidates.append(
                {
                    "brand_name": best_brand,
                    "raw_score": best_conf,
                    "bbox": BoundingBox(x=x1, y=y1, width=w, height=h).model_dump(),
                }
            )

    # Pass 2: Multi-scale sliding-window search (full canvas for posters/screenshots, header/hero for DOM pages)
    use_full_page = (len(dom_images) == 0) if full_page_scan is None else bool(full_page_scan)
    banner_candidates = _sliding_window_banner_search(
        raw_img,
        templates,
        min_score=0.72,
        full_page=use_full_page,
    )
    raw_candidates.extend(banner_candidates)

    # Sort candidates by score descending and apply Non-Maximum Suppression
    raw_candidates.sort(key=lambda c: c["raw_score"], reverse=True)
    detected_logos: list[dict] = []
    kept_boxes: list[dict] = []

    for cand in raw_candidates:
        c_box = cand["bbox"]
        if any(_bbox_overlap(c_box, existing) for existing in kept_boxes):
            continue
        kept_boxes.append(c_box)
        conf_pct = round(min(0.99, cand["raw_score"]) * 100.0, 1)
        detected_logos.append(
            {
                "brand_name": cand["brand_name"],
                "confidence": conf_pct,
                "bbox": c_box,
            }
        )

        x1, y1 = c_box["x"], c_box["y"]
        x2, y2 = x1 + c_box["width"], y1 + c_box["height"]
        cv2.rectangle(ann_img, (x1, y1), (x2, y2), COLOR_LOGO_CRIMSON, thickness=2)
        _draw_label_badge(
            ann_img,
            f"LOGO: {cand['brand_name']} ({conf_pct:.0f}%)",
            x1,
            y1,
            COLOR_LOGO_CRIMSON,
        )

    cv2.imwrite(str(annotated_path), ann_img)
    return detected_logos
