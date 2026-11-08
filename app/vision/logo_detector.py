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
    "insignia_tniad_3d": "TNI Angkatan Darat (Kartika Eka Paksi)",
    "kartika_tniad_3d": "TNI Angkatan Darat (Kartika Eka Paksi)",
    "tni_al_3d": "TNI Angkatan Laut (Jalesveva Jayamahe)",
    "tni_au_3d": "TNI Angkatan Udara (Swa Bhuwana Paksa)",
    "unhan_ri": "Universitas Pertahanan RI (Unhan)",
    "bssn_ri": "Badan Siber dan Sandi Negara (BSSN)",
    "lemhannas_ri": "Lemhannas RI",
    "basarnas_ri": "Basarnas RI",
    "bakamla_ri": "Bakamla RI",
}

_COARSE_FACTOR = 0.35
_COARSE_TOP_K = 4
_REFINE_PAD = 8
_SEMANTIC_SZ: tuple[int, int] = (48, 56)  # (width, height)
_SCALES_BANNER: tuple[int, ...] = (28, 36, 46, 58, 72, 90, 112, 140, 175, 224)
_SCALES_FULL: tuple[int, ...] = (28, 36, 46, 58, 72, 90, 112, 140, 175, 224, 280)

_LOGO_TEMPLATE_CACHE: dict[str, tuple[tuple[str, ...], list[dict]]] = {}


def _compute_semantic_channels(bgr: np.ndarray) -> np.ndarray:
    """
    Compute a 5-channel lighting-direction-invariant semantic map:
      [0] Gold / Brass (invariant to 2D flat vs 3D bevel highlights/shadows)
      [1] Red / Crimson (inner Merah-Putih shield / Kemhan / Kopassus / Mabes core)
      [2] White / Silver (inner Merah-Putih shield / star / scroll)
      [3] Blue / Navy (TNI AL / TNI AU / Kemhan / Unhan)
      [4] Sobel gradient magnitude (structural feather / wreath / shield edges)
    """
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV).astype(np.float32)
    h = hsv[:, :, 0]
    s = hsv[:, :, 1] / 255.0
    v = hsv[:, :, 2] / 255.0

    gold = (
        np.clip(1.0 - np.abs(h - 24.0) / 16.0, 0.0, 1.0)
        * np.clip((s - 0.28) / 0.45, 0.0, 1.0)
        * np.clip((v - 0.25) / 0.45, 0.0, 1.0)
    )
    red_dist = np.minimum(h, 180.0 - h)
    red = (
        np.clip(1.0 - red_dist / 13.0, 0.0, 1.0)
        * np.clip((s - 0.35) / 0.45, 0.0, 1.0)
        * np.clip((v - 0.25) / 0.45, 0.0, 1.0)
    )
    white = np.clip(1.0 - s / 0.30, 0.0, 1.0) * np.clip((v - 0.65) / 0.30, 0.0, 1.0)
    blue = (
        np.clip(1.0 - np.abs(h - 108.0) / 20.0, 0.0, 1.0)
        * np.clip((s - 0.28) / 0.45, 0.0, 1.0)
        * np.clip((v - 0.20) / 0.45, 0.0, 1.0)
    )

    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    grad = np.clip(np.hypot(gx, gy) / 1.2, 0.0, 1.0)
    return np.stack([gold, red, white, blue, grad], axis=-1)


def _zmncc(a: np.ndarray, b: np.ndarray) -> float:
    """Zero-mean normalized cross-correlation (Pearson correlation) over arbitrary tensors."""
    am = a - float(a.mean())
    bm = b - float(b.mean())
    den = float(np.linalg.norm(am) * np.linalg.norm(bm))
    return float(np.sum(am * bm)) / den if den > 1e-6 else 0.0


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

    hist_coarse = cv2.calcHist([hsv], [0, 1], mask_u8, [12, 8], [0, 180, 0, 256])
    hist_smooth = cv2.GaussianBlur(hist_coarse, (3, 3), 0.85)
    cv2.normalize(hist_smooth, hist_smooth, 0, 1, cv2.NORM_MINMAX)

    th0, tw0 = bgr.shape[:2]
    aspect = float(tw0) / float(max(1, th0))
    is_transparent = float(alpha.min()) < 0.50 and float(alpha.mean()) < 0.98

    if is_transparent:
        light_bgr = _composite_bgr(bgr, alpha, np.array([244.0, 244.0, 244.0], dtype=np.float32))
        mid_bgr = _composite_bgr(bgr, alpha, np.array([112.0, 112.0, 112.0], dtype=np.float32))
        dark_bgr = _composite_bgr(bgr, alpha, np.array([20.0, 38.0, 20.0], dtype=np.float32))
        base_variants_gray = [
            cv2.cvtColor(light_bgr, cv2.COLOR_BGR2GRAY),
            cv2.cvtColor(mid_bgr, cv2.COLOR_BGR2GRAY),
            cv2.cvtColor(dark_bgr, cv2.COLOR_BGR2GRAY),
        ]
    else:
        base_variants_gray = [cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)]

    # Precompute tight-cropped semantic 5-channel descriptor for lighting/background-invariant matching
    tight_sem: Optional[np.ndarray] = None
    tight_alpha: Optional[np.ndarray] = None
    tight_aspect: float = aspect
    tight_sym: float = 0.0
    if is_transparent:
        ys, xs = np.where(alpha > 0.20)
        if len(xs) >= 20:
            ty0, ty1 = int(ys.min()), int(ys.max()) + 1
            tx0, tx1 = int(xs.min()), int(xs.max()) + 1
            tight_aspect = float(tx1 - tx0) / float(max(1, ty1 - ty0))
            tbgr = cv2.resize(bgr[ty0:ty1, tx0:tx1], _SEMANTIC_SZ, interpolation=cv2.INTER_AREA)
            talpha = cv2.resize(
                (alpha[ty0:ty1, tx0:tx1] > 0.20).astype(np.float32),
                _SEMANTIC_SZ,
                interpolation=cv2.INTER_LINEAR,
            )
            tsem = cv2.GaussianBlur(
                _compute_semantic_channels(tbgr) * talpha[:, :, None], (5, 5), 1.1
            )
            g_map = tsem[:, :, 0]
            g_energy = float(np.sum(g_map * g_map))
            if g_energy > 1.0:
                tight_sym = float(np.sum(g_map * np.fliplr(g_map))) / (g_energy + 1e-6)
                tight_sem = tsem
                tight_alpha = talpha

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
        "hist_smooth": hist_smooth,
        "aspect": aspect,
        "is_transparent": is_transparent,
        "coarse_pyramid": coarse_pyramid,
        "tight_sem": tight_sem,
        "tight_alpha": tight_alpha,
        "tight_aspect": tight_aspect,
        "tight_sym": tight_sym,
    }


def _verify_patch_color_consistency(patch_bgr: np.ndarray, tpl: dict) -> float:
    """
    Verify HSV color histogram correlation over the template's foreground alpha
    mask so random textured photos do not produce false-positive logo matches,
    while allowing smoothed Hue/Saturation tolerance for 3D metallic / JPEG-shaded crests.
    """
    ph, pw = patch_bgr.shape[:2]
    if ph < 9 or pw < 9:
        return 0.0
    tpl_alpha = cv2.resize(tpl["alpha"], (pw, ph), interpolation=cv2.INTER_LINEAR)
    mask_u8 = (tpl_alpha > 0.18).astype(np.uint8) * 255
    if int(np.count_nonzero(mask_u8)) < 14:
        return 0.5
    patch_hsv = cv2.cvtColor(patch_bgr, cv2.COLOR_BGR2HSV)
    patch_hist = cv2.calcHist([patch_hsv], [0, 1], mask_u8, [24, 24], [0, 180, 0, 256])
    cv2.normalize(patch_hist, patch_hist, 0, 1, cv2.NORM_MINMAX)
    corr_fine = float(cv2.compareHist(patch_hist, tpl["hist"], cv2.HISTCMP_CORREL))

    corr_smooth = 0.0
    if "hist_smooth" in tpl:
        patch_coarse = cv2.calcHist([patch_hsv], [0, 1], mask_u8, [12, 8], [0, 180, 0, 256])
        patch_smooth = cv2.GaussianBlur(patch_coarse, (3, 3), 0.85)
        cv2.normalize(patch_smooth, patch_smooth, 0, 1, cv2.NORM_MINMAX)
        corr_smooth = float(cv2.compareHist(patch_smooth, tpl["hist_smooth"], cv2.HISTCMP_CORREL))

    return max(0.0, corr_fine, corr_smooth * 0.90)


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


def _score_aligned_patch(patch_bgr: np.ndarray, tpl: dict) -> float:
    h, w = patch_bgr.shape[:2]
    tpl_bgr = cv2.resize(tpl["bgr"], (w, h), interpolation=cv2.INTER_AREA)
    if tpl["is_transparent"]:
        tpl_alpha = cv2.resize(tpl["alpha"], (w, h), interpolation=cv2.INTER_LINEAR)
        bg_color = _estimate_border_bg(patch_bgr)
        composited = _composite_bgr(tpl_bgr, tpl_alpha, bg_color)
    else:
        composited = tpl_bgr

    crop_gray = cv2.cvtColor(patch_bgr, cv2.COLOR_BGR2GRAY)
    comp_gray = cv2.cvtColor(composited, cv2.COLOR_BGR2GRAY)

    res = cv2.matchTemplate(crop_gray, comp_gray, cv2.TM_CCOEFF_NORMED)
    ncc_score = max(0.0, float(res[0, 0]))
    if ncc_score < 0.40:
        return ncc_score * 0.75

    ssim_score = max(0.0, compute_ssim_opencv(crop_gray, comp_gray))
    hist_score = _verify_patch_color_consistency(patch_bgr, tpl)
    structural_peak = max(ssim_score, ncc_score)
    return float((0.75 * structural_peak) + (0.25 * hist_score))


def _compare_crop_with_template(
    crop_bgr: np.ndarray, tpl: dict
) -> tuple[float, Optional[tuple[int, int, int, int]]]:
    """
    Compare a cropped DOM `<img>` region against an official logo template.
    Supports both 1:1 standalone crest `<img>` elements AND wide horizontal banner
    lockups (e.g., `[Small Crest] PORTAL TNI AD` inside a single wide `<img>`).
    Returns `(score, optional_sub_bbox_xywh)`.
    """
    h, w = crop_bgr.shape[:2]
    direct_score = _score_aligned_patch(crop_bgr, tpl)
    best_sub_box: Optional[tuple[int, int, int, int]] = None

    expected_w = max(10, int(round(h * tpl["aspect"])))
    if w >= int(expected_w * 1.35) and expected_w < w and h >= 12:
        tpl_bgr = cv2.resize(tpl["bgr"], (expected_w, h), interpolation=cv2.INTER_AREA)
        if tpl["is_transparent"]:
            tpl_alpha = cv2.resize(tpl["alpha"], (expected_w, h), interpolation=cv2.INTER_LINEAR)
            bg_color = _estimate_border_bg(crop_bgr)
            composited = _composite_bgr(tpl_bgr, tpl_alpha, bg_color)
        else:
            composited = tpl_bgr

        crop_gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)
        comp_gray = cv2.cvtColor(composited, cv2.COLOR_BGR2GRAY)
        res = cv2.matchTemplate(crop_gray, comp_gray, cv2.TM_CCOEFF_NORMED)
        _, max_val, _, max_loc = cv2.minMaxLoc(res)
        if float(max_val) >= 0.45:
            sx = int(max_loc[0])
            sub_patch = crop_bgr[:, sx : sx + expected_w]
            sub_score = _score_aligned_patch(sub_patch, tpl)
            if sub_score > direct_score:
                direct_score = sub_score
                best_sub_box = (sx, 0, expected_w, h)

    return direct_score, best_sub_box


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


def _detect_small_emblem_contours_native(
    raw_img: np.ndarray,
    templates: Sequence[dict],
    min_score: float = 0.80,
) -> list[dict]:
    """
    Fast (<12ms) native-resolution contour-guided small-emblem detector (`14px..48px`).
    Finds compact high-gradient emblem patches anywhere on the full-resolution canvas
    and evaluates them directly against templates without coarse pyramid blurring.
    """
    ih, iw = raw_img.shape[:2]
    gray = cv2.cvtColor(raw_img, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 45, 145)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    dilated = cv2.dilate(edges, kernel, iterations=1)
    contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    patches: list[tuple[float, int, int, int, int]] = []
    for cnt in contours:
        x, y, w, h = cv2.boundingRect(cnt)
        if not (13 <= w <= 54 and 14 <= h <= 54):
            continue
        aspect = float(w) / float(max(1, h))
        if not (0.52 <= aspect <= 1.85):
            continue
        # Reject flat solid circles/buttons/letter-dots that lack internal core crest structure
        cy0, cy1 = y + max(2, h // 4), y + min(h - 2, (3 * h) // 4)
        cx0, cx1 = x + max(2, w // 4), x + min(w - 2, (3 * w) // 4)
        core_gray = gray[cy0:cy1, cx0:cx1]
        core_edges = edges[cy0:cy1, cx0:cx1]
        if (
            core_gray.size == 0
            or float(np.std(core_gray)) < 24.0
            or int(np.count_nonzero(core_edges)) < 4
        ):
            continue
        edge_density = float(np.mean(edges[y : y + h, x : x + w] > 0))
        if edge_density < 0.16:
            continue
        patches.append((edge_density, x, y, w, h))

    if not patches:
        return []

    patches.sort(key=lambda item: item[0], reverse=True)
    found: list[dict] = []

    for _, x, y, w, h in patches[:14]:
        # Expand window by 2px and test inner height (accounting for 3x3 dilation padding)
        wx0, wy0 = max(0, x - 2), max(0, y - 2)
        wx1, wy1 = min(iw, x + w + 2), min(ih, y + h + 2)
        win_bgr = raw_img[wy0:wy1, wx0:wx1]
        win_gray = gray[wy0:wy1, wx0:wx1]
        wh, ww = win_bgr.shape[:2]

        best_conf = 0.0
        best_brand = ""
        best_tpl: Optional[dict] = None
        best_rect = (x, y, w, h)

        for tpl in templates:
            if not tpl["is_transparent"]:
                continue
            if abs(float(w) / float(h) - tpl["aspect"]) > 0.42:
                continue
            for th in (max(12, h - 3), max(12, h - 1), h):
                tw = max(10, int(round(th * tpl["aspect"])))
                if th > wh or tw > ww:
                    continue
                tpl_bgr = cv2.resize(tpl["bgr"], (tw, th), interpolation=cv2.INTER_AREA)
                tpl_alpha = cv2.resize(tpl["alpha"], (tw, th), interpolation=cv2.INTER_LINEAR)
                bg_col = _estimate_border_bg(win_bgr)
                comp = _composite_bgr(tpl_bgr, tpl_alpha, bg_col)
                comp_gray = cv2.cvtColor(comp, cv2.COLOR_BGR2GRAY)
                res = cv2.matchTemplate(win_gray, comp_gray, cv2.TM_CCOEFF_NORMED)
                _, max_val, _, max_loc = cv2.minMaxLoc(res)
                if float(max_val) < 0.68:
                    continue
                px, py = int(max_loc[0]), int(max_loc[1])
                aligned_crop = win_bgr[py : py + th, px : px + tw]
                score = _score_aligned_patch(aligned_crop, tpl)
                if score > best_conf:
                    best_conf = score
                    best_brand = tpl["brand"]
                    best_tpl = tpl
                    best_rect = (wx0 + px, wy0 + py, tw, th)

        if best_tpl is not None and best_conf >= min_score:
            rx, ry, rw, rh = best_rect
            aligned_crop = raw_img[ry : ry + rh, rx : rx + rw]
            color_corr = _verify_patch_color_consistency(aligned_crop, best_tpl)
            if color_corr >= 0.48:
                found.append(
                    {
                        "brand_name": best_brand,
                        "raw_score": best_conf,
                        "bbox": {"x": int(rx), "y": int(ry), "width": int(rw), "height": int(rh)},
                    }
                )

    return found


def _split_wide_emblem_contour(
    mask: np.ndarray, x: int, y: int, w: int, h: int
) -> list[tuple[int, int, int, int]]:
    """
    2D contour splitter for adjacent or blur-merged emblems:
      1. If a tall/wide contour (`h >= 90 and w >= 90`) merges a top header logo row with
         a text headline below it (due to JPEG/Gaussian blur), split horizontally at row valleys.
      2. If a horizontal band is wide (`w/h > 1.42`), split vertically at column valleys and
         also emit adjacent segment pairs so split-wreath crests (e.g. TNI AL blue center shield)
         remain intact.
    """
    sub_mask = (mask[y : y + h, x : x + w] > 0).astype(np.float32)

    row_batches: list[tuple[int, int]] = [(0, h)]
    if h >= 90 and w >= 90:
        r_sums = sub_mask.sum(axis=1)
        r_peak = float(r_sums.max())
        if r_peak > 4.0:
            r_margin = max(16, int(h * 0.14))
            r_valleys = [
                idx
                for idx in range(r_margin, h - r_margin)
                if r_sums[idx] <= 0.18 * r_peak
            ]
            if r_valleys:
                r_splits: list[int] = []
                r_group = [r_valleys[0]]
                for v in r_valleys[1:]:
                    if v <= r_group[-1] + 4:
                        r_group.append(v)
                    else:
                        r_splits.append(int(round(sum(r_group) / len(r_group))))
                        r_group = [v]
                r_splits.append(int(round(sum(r_group) / len(r_group))))
                r_bounds = [0] + r_splits + [h]
                row_batches = [
                    (r_bounds[i], r_bounds[i + 1])
                    for i in range(len(r_bounds) - 1)
                    if r_bounds[i + 1] - r_bounds[i] >= 18
                ] or [(0, h)]

    out_boxes: list[tuple[int, int, int, int]] = []
    for ry0, ry1 in row_batches:
        r_seg = sub_mask[ry0:ry1, :]
        ys0, xs0 = np.where(r_seg > 0)
        if len(xs0) < 16:
            continue
        cx0, cx1 = int(xs0.min()), int(xs0.max()) + 1
        ry_top = ry0 + int(ys0.min())
        ry_bot = ry0 + int(ys0.max()) + 1
        rh = ry_bot - ry_top
        cw = cx1 - cx0
        if cw < 18 or rh < 18:
            continue
        c_seg = sub_mask[ry_top:ry_bot, cx0:cx1]

        aspect = float(cw) / float(max(1, rh))
        if aspect > 1.42 and cw >= 42:
            col_sums = c_seg.sum(axis=0)
            peak = float(col_sums.max())
            margin = max(10, int(cw * 0.14))
            valleys = [
                idx
                for idx in range(margin, cw - margin)
                if col_sums[idx] <= 0.28 * peak
            ]
            if valleys:
                splits: list[int] = []
                cur_group = [valleys[0]]
                for v in valleys[1:]:
                    if v <= cur_group[-1] + 4:
                        cur_group.append(v)
                    else:
                        splits.append(int(round(sum(cur_group) / len(cur_group))))
                        cur_group = [v]
                splits.append(int(round(sum(cur_group) / len(cur_group))))

                boundaries = [0] + splits + [cw]
                segs: list[tuple[int, int, int, int]] = []
                for i in range(len(boundaries) - 1):
                    sx0, sx1 = boundaries[i], boundaries[i + 1]
                    if sx1 - sx0 < 14:
                        continue
                    seg = c_seg[:, sx0:sx1]
                    ys, xs = np.where(seg > 0)
                    if len(xs) < 12:
                        continue
                    bx = x + cx0 + sx0 + int(xs.min())
                    by = y + ry_top + int(ys.min())
                    bw = int(xs.max() - xs.min()) + 1
                    bh = int(ys.max() - ys.min()) + 1
                    segs.append((bx, by, bw, bh))
                    if 16 <= bw <= 280 and 16 <= bh <= 280 and 0.44 <= float(bw) / float(bh) <= 1.48:
                        out_boxes.append((bx, by, bw, bh))

                # Emit adjacent segment pairs for split-wreath crests (e.g. TNI AL on blurry posters)
                for i in range(len(segs) - 1):
                    bx1, by1, bw1, bh1 = segs[i]
                    bx2, by2, bw2, bh2 = segs[i + 1]
                    mx0 = min(bx1, bx2)
                    my0 = min(by1, by2)
                    mw = max(bx1 + bw1, bx2 + bw2) - mx0
                    mh = max(by1 + bh1, by2 + bh2) - my0
                    if 18 <= mw <= 280 and 18 <= mh <= 280 and 0.62 <= float(mw) / float(mh) <= 1.32:
                        out_boxes.append((mx0, my0, mw, mh))
                    if 18 <= mw <= 280 and 18 <= rh <= 280 and 0.62 <= float(mw) / float(rh) <= 1.32:
                        out_boxes.append((mx0, y + ry_top, mw, rh))
                continue

        if 16 <= cw <= 280 and 16 <= rh <= 280 and 0.44 <= aspect <= 1.48:
            out_boxes.append((x + cx0, y + ry_top, cw, rh))

    return out_boxes or [(x, y, w, h)]


def _detect_emblem_regions_semantic(
    raw_img: np.ndarray,
    templates: Sequence[dict],
    min_score: float = 0.66,
    is_degraded: bool = False,
) -> list[dict]:
    """
    Lighting-direction-, blur-, and photo-background-invariant semantic emblem detector.
    Proposes candidate emblem regions from HSV metallic/gold contours across all scales
    (`18px..280px`) and verifies them against reference templates in 5-channel semantic space
    plus foreground-masked BGR correlation on blurry/low-resolution images.
    """
    sem_templates = [
        t
        for t in templates
        if t.get("tight_sem") is not None and t.get("tight_alpha") is not None
    ]
    if not sem_templates:
        return []

    ih, iw = raw_img.shape[:2]
    hsv = cv2.cvtColor(raw_img, cv2.COLOR_BGR2HSV)

    # Propose contours from both standard metallic gold and warm/bronze gold masks
    mask_specs: tuple[tuple[tuple[int, int, int], tuple[int, int, int], int], ...] = (
        (
            ((13, 90, 80), (35, 255, 255), 4),
            ((10, 68, 68), (38, 255, 255), 3),
            ((14, 105, 85), (34, 255, 255), 2),
        )
        if is_degraded
        else (
            ((13, 90, 80), (35, 255, 255), 5),
            ((10, 68, 68), (38, 255, 255), 3),
        )
    )

    candidate_boxes: list[tuple[int, int, int, int]] = []
    for lo_hsv, hi_hsv, ksz in mask_specs:
        mask = cv2.inRange(hsv, lo_hsv, hi_hsv)
        dilated = cv2.dilate(mask, np.ones((ksz, ksz), np.uint8))
        cnts, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for c in cnts:
            x, y, w, h = cv2.boundingRect(c)
            if not (18 <= w <= 620 and 18 <= h <= 340):
                continue
            for sub_box in _split_wide_emblem_contour(mask, x, y, w, h):
                sx, sy, sw, sh = sub_box
                asp = float(sw) / float(max(1, sh))
                if 0.44 <= asp <= 1.46:
                    candidate_boxes.append(sub_box)

    if not candidate_boxes:
        return []

    # Deduplicate near-identical proposed contour boxes and prioritize top-of-page & larger emblems
    unique_boxes: list[tuple[int, int, int, int]] = []
    for bx, by, bw, bh in candidate_boxes:
        b_dict = {"x": bx, "y": by, "width": bw, "height": bh}
        if not any(
            _bbox_overlap(b_dict, {"x": ux, "y": uy, "width": uw, "height": uh})
            and abs(bw - uw) <= 8
            and abs(bh - uh) <= 8
            for ux, uy, uw, uh in unique_boxes
        ):
            unique_boxes.append((bx, by, bw, bh))

    unique_boxes.sort(key=lambda b: (0 if b[1] < ih * 0.35 else 1, -(b[2] * b[3])))

    found: list[dict] = []
    min_sym = 0.58 if is_degraded else 0.65
    for x, y, w, h in unique_boxes[:40]:
        best_score = 0.0
        best_brand = ""
        best_rect = (x, y, w, h)

        dy_steps = (0, max(1, int(round(h * 0.05))), -max(1, int(round(h * 0.05))))
        dh_steps = (0, -max(1, int(round(h * 0.06))), max(1, int(round(h * 0.06))))

        for dy in dy_steps:
            for dh in dh_steps:
                ny = max(0, min(ih - 16, y + dy))
                nh = max(16, min(ih - ny, h + dh))
                patch_bgr = raw_img[ny : ny + nh, x : x + w]
                crop = cv2.resize(
                    patch_bgr,
                    _SEMANTIC_SZ,
                    interpolation=cv2.INTER_AREA,
                )
                c_sem = cv2.GaussianBlur(_compute_semantic_channels(crop), (5, 5), 1.1)
                g_map = c_sem[:, :, 0]
                g_energy = float(np.sum(g_map * g_map))
                if g_energy < 1.0:
                    continue
                c_sym = float(np.sum(g_map * np.fliplr(g_map))) / (g_energy + 1e-6)
                if c_sym < min_sym:
                    continue

                cand_asp = float(w) / float(nh)
                for tpl in sem_templates:
                    if abs(cand_asp - float(tpl["tight_aspect"])) > 0.25:
                        continue
                    t_sem: np.ndarray = tpl["tight_sem"]
                    t_alpha: np.ndarray = tpl["tight_alpha"]

                    gold_ncc = _zmncc(g_map, t_sem[:, :, 0])
                    full_ncc = _zmncc(c_sem[:, :, :4], t_sem[:, :, :4])
                    grad_ncc = _zmncc(c_sem[:, :, 4] * t_alpha, t_sem[:, :, 4])

                    if gold_ncc >= 0.58 and grad_ncc >= 0.45:
                        score = 0.45 * gold_ncc + 0.35 * full_ncc + 0.20 * grad_ncc
                    elif (
                        is_degraded
                        and w >= 24
                        and nh >= 24
                        and gold_ncc >= 0.30
                        and full_ncc >= 0.45
                        and grad_ncc >= 0.52
                    ):
                        # Blur-resilient foreground ZMNCC fallback for degraded/low-res posters
                        tb_blur = cv2.GaussianBlur(
                            cv2.resize(tpl["bgr"], _SEMANTIC_SZ, interpolation=cv2.INTER_AREA),
                            (5, 5),
                            1.3,
                        )
                        fg_mask = t_alpha > 0.25
                        fg_ncc = _zmncc(
                            crop[fg_mask].astype(np.float32),
                            tb_blur[fg_mask].astype(np.float32),
                        )
                        color_corr = _verify_patch_color_consistency(patch_bgr, tpl)
                        if fg_ncc >= 0.68 and color_corr >= 0.45:
                            score = max(
                                0.67,
                                0.45 * fg_ncc + 0.30 * full_ncc + 0.25 * grad_ncc,
                            )
                        else:
                            continue
                    else:
                        continue

                    if score > best_score:
                        best_score = score
                        best_brand = tpl["brand"]
                        best_rect = (x, ny, w, nh)

        if best_score >= min_score and best_brand:
            rx, ry, rw, rh = best_rect
            calibrated = min(0.98, max(best_score, 0.80 + (best_score - 0.66) * 0.56))
            found.append(
                {
                    "brand_name": best_brand,
                    "raw_score": float(calibrated),
                    "bbox": {"x": int(rx), "y": int(ry), "width": int(rw), "height": int(rh)},
                }
            )

    return found


def _coarse_to_fine_search(
    roi: np.ndarray,
    roi_coarse_gray: np.ndarray,
    tpl: dict,
    scales: Sequence[int],
    img_w: int,
    is_degraded: bool = False,
) -> tuple[float, Optional[dict]]:
    """
    Fast pre-cached coarse-to-fine multi-scale search across `roi`.
    Coarse pass uses pre-resized grayscale templates (zero resize/cvtColor per scan),
    retaining top hypotheses per scale band so small text noise never crowds out medium/large crests.
    """
    roi_h, roi_w = roi.shape[:2]
    rc_h, rc_w = roi_coarse_gray.shape[:2]
    pyramid: dict[int, tuple[int, list[np.ndarray]]] = tpl["coarse_pyramid"]
    band_hypotheses: dict[int, list[tuple[float, int, int, int, int]]] = {0: [], 1: [], 2: []}

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
        band = 0 if target_h <= 48 else (1 if target_h <= 125 else 2)
        for t_gray in scaled_grays:
            res = cv2.matchTemplate(roi_coarse_gray, t_gray, cv2.TM_CCOEFF_NORMED)
            _, max_val, _, max_loc = cv2.minMaxLoc(res)
            if max_val >= 0.44:
                x = int(round(max_loc[0] / _COARSE_FACTOR))
                y = int(round(max_loc[1] / _COARSE_FACTOR))
                band_hypotheses[band].append((float(max_val), target_h, target_w, x, y))

    selected_hypotheses: list[tuple[float, int, int, int, int]] = []
    for b_list in band_hypotheses.values():
        if b_list:
            b_list.sort(key=lambda hyp: hyp[0], reverse=True)
            selected_hypotheses.extend(b_list[:2])

    if not selected_hypotheses:
        return 0.0, None

    selected_hypotheses.sort(key=lambda hyp: hyp[0], reverse=True)

    best_score = 0.0
    best_box: Optional[dict] = None
    aspect = tpl["aspect"]
    base_bgr = tpl["bgr"]
    base_alpha = tpl["alpha"]
    is_trans = tpl["is_transparent"]

    for _, base_h, _, x, y in selected_hypotheses[:_COARSE_TOP_K]:
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
            t_alpha: Optional[np.ndarray] = None
            if is_trans:
                t_alpha = cv2.resize(base_alpha, (tw, th), interpolation=cv2.INTER_LINEAR)
                local_bg = _estimate_border_bg(window)
                t_comp = _composite_bgr(t_bgr, t_alpha, local_bg)
            else:
                t_comp = t_bgr

            res = cv2.matchTemplate(window, t_comp, cv2.TM_CCOEFF_NORMED)
            _, max_val, _, max_loc = cv2.minMaxLoc(res)
            cand_val = float(max_val)

            # On blurry / JPEG-degraded images where photo background lowers rectangular NCC,
            # verify foreground-only correlation at the aligned peak
            if (
                is_degraded
                and is_trans
                and t_alpha is not None
                and cand_val >= 0.50
                and tw >= 32
                and th >= 32
            ):
                px, py = int(max_loc[0]), int(max_loc[1])
                patch = window[py : py + th, px : px + tw]
                tb_blur = cv2.GaussianBlur(t_bgr, (5, 5), 1.3)
                fg_mask = t_alpha > 0.25
                if int(np.count_nonzero(fg_mask)) >= 36:
                    fg_ncc = _zmncc(
                        patch[fg_mask].astype(np.float32),
                        tb_blur[fg_mask].astype(np.float32),
                    )
                    if fg_ncc >= 0.80:
                        cc = _verify_patch_color_consistency(patch, tpl)
                        if cc >= 0.52:
                            cand_val = max(cand_val, min(0.90, fg_ncc * 0.95))

            if cand_val > best_score:
                best_score = cand_val
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
    Multi-scale sliding-window template search across banner/hero or full poster canvas,
    combined with native-resolution contour-guided small-emblem detection (`10px..48px`),
    lighting/background-invariant semantic emblem detection (`18px..280px`), and automatic
    super-resolution / unsharp-mask restoration for low-resolution or blurry uploads.
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
    elif min(orig_h, orig_w) < 480 or max(orig_h, orig_w) < 760:
        work_scale = min(
            3.2,
            max(
                760.0 / float(max(1, max(orig_h, orig_w))),
                480.0 / float(max(1, min(orig_h, orig_w))),
            ),
        )
        work_img = cv2.resize(
            raw_img,
            (max(64, int(round(orig_w * work_scale))), max(64, int(round(orig_h * work_scale)))),
            interpolation=cv2.INTER_CUBIC,
        )

    img_h, img_w = work_img.shape[:2]
    roi_h = img_h if full_page else min(img_h, 440)
    roi = work_img[:roi_h, :]

    roi_gray_full = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    lap_var = float(cv2.Laplacian(roi_gray_full, cv2.CV_64F).var())
    is_degraded = (work_scale > 1.05) or (lap_var < 260.0)

    if is_degraded:
        blur_roi = cv2.GaussianBlur(roi, (0, 0), 2.0)
        sharp_roi = cv2.addWeighted(roi, 1.75, blur_roi, -0.75, 0)
        hsv_roi = cv2.cvtColor(sharp_roi, cv2.COLOR_BGR2HSV).astype(np.float32)
        hsv_roi[:, :, 1] = np.clip(hsv_roi[:, :, 1] * 1.20, 0.0, 255.0)
        restored_roi = cv2.cvtColor(hsv_roi.astype(np.uint8), cv2.COLOR_HSV2BGR)
    else:
        restored_roi = roi

    roi_coarse_gray = cv2.cvtColor(
        cv2.resize(roi, None, fx=_COARSE_FACTOR, fy=_COARSE_FACTOR, interpolation=cv2.INTER_AREA),
        cv2.COLOR_BGR2GRAY,
    )

    scales = _SCALES_FULL if full_page else _SCALES_BANNER
    candidates: list[dict] = []

    for tpl in templates:
        best_tpl_score, best_tpl_box = _coarse_to_fine_search(
            roi, roi_coarse_gray, tpl, scales, img_w, is_degraded=is_degraded
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
                    "width": max(12, int(round(bw / work_scale))),
                    "height": max(12, int(round(bh / work_scale))),
                }

            candidates.append(
                {
                    "brand_name": tpl["brand"],
                    "raw_score": best_tpl_score,
                    "bbox": best_tpl_box,
                }
            )

    # Native-resolution contour-guided small-emblem pass (catches 14px..48px logos anywhere on canvas)
    small_hits = _detect_small_emblem_contours_native(raw_img, templates, min_score=0.80)
    candidates.extend(small_hits)

    # Lighting-, blur-, & photo-background-invariant semantic emblem pass
    semantic_hits = _detect_emblem_regions_semantic(
        restored_roi, templates, min_score=0.66, is_degraded=is_degraded
    )
    if work_scale != 1.0:
        for sh in semantic_hits:
            sb = sh["bbox"]
            sh["bbox"] = {
                "x": max(0, min(orig_w - 1, int(round(sb["x"] / work_scale)))),
                "y": max(0, min(orig_h - 1, int(round(sb["y"] / work_scale)))),
                "width": max(12, int(round(sb["width"] / work_scale))),
                "height": max(12, int(round(sb["height"] / work_scale))),
            }
    candidates.extend(semantic_hits)

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

    # Pass 1: Inspect deduplicated logo-proportioned DOM <img> bounding boxes (down to 12x12px)
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
        if w < 10 or h < 12:
            continue
        aspect = float(w) / float(h)
        if w > 640 or h > 420 or aspect < 0.35 or aspect > 6.5:
            continue
        key_box = (x1, y1, w, h)
        if key_box in seen_dom_boxes:
            continue
        seen_dom_boxes.add(key_box)
        meta_hint = f"{dom_img.alt or ''} {dom_img.src or ''}".lower()
        priority = (
            0
            if any(
                k in meta_hint
                for k in ("logo", "lambang", "crest", "tni", "kemhan", "panpus", "icon", "favicon")
            )
            else (1 if y1 < 360 else 2)
        )
        filtered_dom_imgs.append((priority, dom_img, x1, y1, w, h))

    filtered_dom_imgs.sort(key=lambda item: (item[0], item[3]))
    for _, dom_img, x1, y1, w, h in filtered_dom_imgs[:28]:
        crop_bgr = raw_img[y1 : y1 + h, x1 : x1 + w]

        best_conf = 0.0
        best_brand = "TNI AD / Kartika Eka Paksi"
        best_sub: Optional[tuple[int, int, int, int]] = None

        for tpl in templates:
            score, sub_box = _compare_crop_with_template(crop_bgr, tpl)
            if score > best_conf:
                best_conf = score
                best_brand = tpl["brand"]
                best_sub = sub_box

        alt_lower = (dom_img.alt or "").lower()
        if any(k in alt_lower for k in ("kartika", "tni", "pussiberad", "panpus", "kemhan")):
            best_conf = max(best_conf, 0.92)

        if best_conf >= threshold:
            if best_sub is not None:
                sx, sy, sw, sh = best_sub
                cand_bbox = BoundingBox(x=x1 + sx, y=y1 + sy, width=sw, height=sh).model_dump()
            else:
                cand_bbox = BoundingBox(x=x1, y=y1, width=w, height=h).model_dump()
            raw_candidates.append(
                {
                    "brand_name": best_brand,
                    "raw_score": best_conf,
                    "bbox": cand_bbox,
                }
            )

    # Pass 2: Multi-scale sliding-window search + native small-emblem contour detector
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
    placed_badges: list[tuple[int, int, int, int]] = []

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

    # First draw all red bounding boxes so no box is obscured
    for logo_item in detected_logos:
        c_box = logo_item["bbox"]
        x1, y1 = c_box["x"], c_box["y"]
        x2, y2 = x1 + c_box["width"], y1 + c_box["height"]
        cv2.rectangle(ann_img, (x1, y1), (x2, y2), COLOR_LOGO_CRIMSON, thickness=2)

    # Then place label badges, preferring above the box if space permits (`y1 >= bh_b`),
    # otherwise below the box (`y2 + bh_b + 2`) and avoiding overlap with other logo boxes
    for logo_item in detected_logos:
        c_box = logo_item["bbox"]
        x1, y1 = c_box["x"], c_box["y"]
        x2, y2 = x1 + c_box["width"], y1 + c_box["height"]
        conf_pct = logo_item["confidence"]

        badge_text = f"LOGO: {logo_item['brand_name']} ({conf_pct:.0f}%)"
        (tw_b, th_b), base_b = cv2.getTextSize(badge_text, cv2.FONT_HERSHEY_SIMPLEX, 0.48, 1)
        bh_b = th_b + base_b + 8
        bw_b = tw_b + 12
        bx_left = max(0, min(x1, img_w - bw_b))
        bx_right = min(img_w, bx_left + bw_b)

        if y1 >= bh_b:
            candidate_ys = [y1, min(img_h, y2 + bh_b + 2)]
        else:
            candidate_ys = [min(img_h, y2 + bh_b + 2), y1]
        for _, _, _, pb_bot in placed_badges:
            candidate_ys.append(min(img_h, pb_bot + bh_b + 2))

        chosen_y = candidate_ys[0]
        for cy in candidate_ys:
            top_y = max(0, cy - bh_b)
            bot_y = top_y + bh_b
            collides_badge = any(
                not (bx_right < px1 or bx_left > px2 or bot_y < py1 or top_y > py2)
                for px1, py1, px2, py2 in placed_badges
            )
            collides_logo = any(
                not (
                    bx_right < kb["x"] + 4
                    or bx_left > kb["x"] + kb["width"] - 4
                    or bot_y < kb["y"] + 6
                    or top_y > kb["y"] + kb["height"] - 6
                )
                for kb in kept_boxes
            )
            if not collides_badge and not collides_logo:
                chosen_y = cy
                placed_badges.append((bx_left, top_y, bx_right, bot_y))
                break
        else:
            for cy in candidate_ys:
                top_y = max(0, cy - bh_b)
                bot_y = top_y + bh_b
                collides_badge = any(
                    not (bx_right < px1 or bx_left > px2 or bot_y < py1 or top_y > py2)
                    for px1, py1, px2, py2 in placed_badges
                )
                if not collides_badge:
                    chosen_y = cy
                    placed_badges.append((bx_left, top_y, bx_right, bot_y))
                    break
            else:
                top_y = max(0, chosen_y - bh_b)
                placed_badges.append((bx_left, top_y, bx_right, top_y + bh_b))

        _draw_label_badge(
            ann_img,
            badge_text,
            x1,
            chosen_y,
            COLOR_LOGO_CRIMSON,
        )

    cv2.imwrite(str(annotated_path), ann_img)
    return detected_logos
