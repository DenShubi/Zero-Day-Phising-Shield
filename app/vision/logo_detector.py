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
    "panpus-logo": "Panpus Penerimaan Prajurit TNI AD",
    "kemhan": "Kementerian Pertahanan RI",
    "logo-seskoad": "SESKOAD TNI Angkatan Darat",
    "rekrutmen-tni": "Portal Rekrutmen TNI",
    "kartika_eka_paksi_crest": "TNI AD / Kartika Eka Paksi",
    "pussiberad_emblem": "PUSSIBERAD TNI AD",
}


def _load_logo_template(tpl_path: Path) -> Optional[dict]:
    """
    Load a reference logo PNG (supporting RGBA transparency) and precompute
    normalized RGB, grayscale, alpha mask, and HSV histogram for matching.
    """
    raw = cv2.imread(str(tpl_path), cv2.IMREAD_UNCHANGED)
    if raw is None:
        return None

    # Downscale very high-res logos (e.g. 3000x3000 kemhan.png) while preserving aspect ratio
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

    return {
        "stem": tpl_path.stem,
        "brand": LOGO_LABELS.get(tpl_path.stem, tpl_path.stem),
        "bgr": bgr,
        "alpha": alpha,
        "hist": hist,
    }


def _compare_crop_with_template(crop_bgr: np.ndarray, tpl: dict) -> float:
    """
    Compare a cropped DOM `<img>` region against an official logo template,
    compositing transparent RGBA templates onto the crop's border background
    color so transparent PNGs match cleanly against dark or light pages.
    """
    h, w = crop_bgr.shape[:2]
    tpl_bgr = cv2.resize(tpl["bgr"], (w, h), interpolation=cv2.INTER_AREA)
    tpl_alpha = cv2.resize(tpl["alpha"], (w, h), interpolation=cv2.INTER_LINEAR)

    # Estimate background color from the 4 corners of the crop
    corners = np.array(
        [crop_bgr[0, 0], crop_bgr[0, w - 1], crop_bgr[h - 1, 0], crop_bgr[h - 1, w - 1]],
        dtype=np.float32,
    )
    bg_color = np.median(corners, axis=0)

    composited = np.zeros_like(crop_bgr, dtype=np.uint8)
    for c in range(3):
        composited[:, :, c] = np.clip(
            tpl_alpha * tpl_bgr[:, :, c] + (1.0 - tpl_alpha) * bg_color[c],
            0,
            255,
        ).astype(np.uint8)

    crop_gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)
    comp_gray = cv2.cvtColor(composited, cv2.COLOR_BGR2GRAY)

    ssim_score = max(0.0, compute_ssim_opencv(crop_gray, comp_gray))
    res = cv2.matchTemplate(crop_gray, comp_gray, cv2.TM_CCOEFF_NORMED)
    ncc_score = max(0.0, float(res[0, 0]))

    crop_hsv = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2HSV)
    mask_u8 = (tpl_alpha > 0.15).astype(np.uint8) * 255
    crop_hist = cv2.calcHist([crop_hsv], [0, 1], mask_u8, [24, 24], [0, 180, 0, 256])
    cv2.normalize(crop_hist, crop_hist, 0, 1, cv2.NORM_MINMAX)
    hist_score = max(0.0, float(cv2.compareHist(crop_hist, tpl["hist"], cv2.HISTCMP_CORREL)))

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


def _sliding_window_banner_search(
    raw_img: np.ndarray,
    templates: Sequence[dict],
    min_score: float = 0.72,
) -> list[dict]:
    """
    Multi-scale sliding-window template search across the top header/banner
    area (y: 0..360) so logos baked directly into wide background images or CSS
    banners (e.g., kemhan.go.id, tniad.mil.id, tni.mil.id) are detected even
    when there is no standalone `<img>` tag for the emblem.
    """
    img_h, img_w = raw_img.shape[:2]
    roi_h = min(img_h, 440)
    roi = raw_img[:roi_h, :]

    scales = [28, 30, 34, 38, 48, 58, 60, 72, 90, 115, 145, 185, 222, 226]
    candidates: list[dict] = []
    header_bg = roi[min(25, roi_h - 1), min(80, img_w - 1)].astype(np.float32)
    mil_green_bg = np.array([10.0, 55.0, 15.0], dtype=np.float32)

    for tpl in templates:
        base_bgr = tpl["bgr"]
        base_alpha = tpl["alpha"]
        th0, tw0 = base_bgr.shape[:2]
        aspect = float(tw0) / float(th0)

        # Build both raw BGR and background-composited BGR for transparent lockups/crests
        variants = [base_bgr]
        if float(base_alpha.mean()) < 0.85:
            a3 = base_alpha[:, :, None]
            comp_header = np.clip(a3 * base_bgr + (1.0 - a3) * header_bg, 0, 255).astype(np.uint8)
            comp_green = np.clip(a3 * base_bgr + (1.0 - a3) * mil_green_bg, 0, 255).astype(np.uint8)
            variants.append(comp_header)
            variants.append(comp_green)

        best_tpl_score = 0.0
        best_tpl_box: Optional[dict] = None

        for target_h in scales:
            target_w = max(20, int(round(target_h * aspect)))
            if target_h >= roi_h or target_w >= img_w:
                continue

            for var_bgr in variants:
                t_bgr = cv2.resize(var_bgr, (target_w, target_h), interpolation=cv2.INTER_AREA)
                res = cv2.matchTemplate(roi, t_bgr, cv2.TM_CCOEFF_NORMED)
                _, max_val, _, max_loc = cv2.minMaxLoc(res)
                score = float(max_val)

                if score > best_tpl_score:
                    best_tpl_score = score
                    best_tpl_box = {
                        "x": int(max_loc[0]),
                        "y": int(max_loc[1]),
                        "width": int(target_w),
                        "height": int(target_h),
                    }

        if best_tpl_box is not None and best_tpl_score >= min_score:
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
    threshold: float = 0.62,
) -> list[dict]:
    """
    Detect impersonated TNI AD / Kartika Eka Paksi / Panpus / Kemhan logos
    from `app/reference_db/logos/*.png` (via both DOM `<img>` crops and
    multi-scale sliding-window search over header/background banners) and draw
    red bounding boxes on `annotated_path`.
    """
    if logos_dir is None:
        logos_dir = Path(__file__).resolve().parent.parent / "reference_db" / "logos"
    else:
        logos_dir = Path(logos_dir)

    raw_img = cv2.imread(str(screenshot_path))
    ann_img = cv2.imread(str(annotated_path))
    if raw_img is None:
        return []
    if ann_img is None:
        ann_img = raw_img.copy()

    templates: list[dict] = []
    if logos_dir.exists():
        for tpl_path in sorted(logos_dir.glob("*.png")):
            loaded = _load_logo_template(tpl_path)
            if loaded is not None:
                templates.append(loaded)

    raw_candidates: list[dict] = []
    img_h, img_w = raw_img.shape[:2]

    # Pass 1: Inspect standalone logo-proportioned DOM <img> bounding boxes
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

        # Skip full-width hero/background <img> elements here; Pass 2 slides across them
        aspect = float(w) / float(h)
        if w > 550 or h > 380 or aspect < 0.45 or aspect > 5.0:
            continue

        crop_bgr = raw_img[y1:y2, x1:x2]

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

    # Pass 2: Multi-scale sliding-window search across header/background banners
    banner_candidates = _sliding_window_banner_search(raw_img, templates, min_score=0.72)
    raw_candidates.extend(banner_candidates)

    # Sort candidates by score descending and apply Non-Maximum Suppression (IoU > 0.35)
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
