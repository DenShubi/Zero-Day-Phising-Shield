import json
import math
from pathlib import Path
from typing import Optional, Union

import cv2
import numpy as np

_SIM_W = 320
_SIM_H = 180
_C1 = float((0.01 * 255) ** 2)
_C2 = float((0.03 * 255) ** 2)


def compute_ssim_map_opencv(img1_gray: np.ndarray, img2_gray: np.ndarray) -> np.ndarray:
    """
    Compute per-pixel Structural Similarity Index (SSIM) map between two
    grayscale images of identical shape (Wang et al., 2004) using float32.
    """
    i1 = img1_gray.astype(np.float32)
    i2 = img2_gray.astype(np.float32)

    mu1 = cv2.GaussianBlur(i1, (11, 11), 1.5)
    mu2 = cv2.GaussianBlur(i2, (11, 11), 1.5)

    mu1_sq = mu1 * mu1
    mu2_sq = mu2 * mu2
    mu1_mu2 = mu1 * mu2

    sigma1_sq = cv2.GaussianBlur(i1 * i1, (11, 11), 1.5) - mu1_sq
    sigma2_sq = cv2.GaussianBlur(i2 * i2, (11, 11), 1.5) - mu2_sq
    sigma12 = cv2.GaussianBlur(i1 * i2, (11, 11), 1.5) - mu1_mu2

    numerator = (2.0 * mu1_mu2 + _C1) * (2.0 * sigma12 + _C2)
    denominator = (mu1_sq + mu2_sq + _C1) * (sigma1_sq + sigma2_sq + _C2)

    return numerator / denominator


def compute_ssim_opencv(img1_gray: np.ndarray, img2_gray: np.ndarray) -> float:
    """Mean Structural Similarity Index (SSIM) across the full image."""
    return float(np.mean(compute_ssim_map_opencv(img1_gray, img2_gray)))


def _precompute_ssim_stats(gray_u8: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Precompute `(img_f32, mu, mu_sq, sigma_sq)` so pairwise SSIM only needs 1 blur."""
    img_f = gray_u8.astype(np.float32)
    mu = cv2.GaussianBlur(img_f, (11, 11), 1.5)
    mu_sq = mu * mu
    sigma_sq = cv2.GaussianBlur(img_f * img_f, (11, 11), 1.5) - mu_sq
    return img_f, mu, mu_sq, sigma_sq


def _fast_ssim_map_from_stats(
    s1: tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray],
    s2: tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray],
) -> np.ndarray:
    """Compute exact SSIM map using precomputed per-image Gaussian statistics (1 blur instead of 5)."""
    i1, mu1, mu1_sq, sigma1_sq = s1
    i2, mu2, mu2_sq, sigma2_sq = s2
    mu1_mu2 = mu1 * mu2
    sigma12 = cv2.GaussianBlur(i1 * i2, (11, 11), 1.5) - mu1_mu2
    numerator = (2.0 * mu1_mu2 + _C1) * (2.0 * sigma12 + _C2)
    denominator = (mu1_sq + mu2_sq + _C1) * (sigma1_sq + sigma2_sq + _C2)
    return numerator / denominator


def _edge_magnitude(gray: np.ndarray) -> np.ndarray:
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    mag = cv2.magnitude(gx, gy)
    return np.clip(mag, 0, 255).astype(np.uint8)


def _nonwhite_hsv_hist(bgr_small: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """
    Compute HSV histogram over non-blank pixels (`S > 22` or `V < 225`) so two
    unrelated white-background websites (e.g. Google vs PPID) do not get an
    artificially inflated 90%+ color match just from empty white space.
    """
    hsv = cv2.cvtColor(bgr_small, cv2.COLOR_BGR2HSV)
    active_color_mask = ((hsv[:, :, 1] > 22) | (hsv[:, :, 2] < 225)).astype(np.uint8) * 255
    if int(np.count_nonzero(active_color_mask)) < 80:
        active_color_mask = None  # fallback if image is nearly solid white
    hist = cv2.calcHist([hsv], [0, 1], active_color_mask, [30, 32], [0, 180, 0, 256])
    cv2.normalize(hist, hist, 0, 1, cv2.NORM_MINMAX)
    return hist, hsv


_PORTAL_REF_CACHE: dict[str, tuple[tuple[str, ...], list[dict]]] = {}


def _get_cached_portal_refs(reference_portals_dir: Path) -> list[dict]:
    """Precompute and cache 320x180 SSIM statistics, Sobel edges, HSV histograms & metadata for all reference portals."""
    if not reference_portals_dir.exists():
        return []
    png_files = sorted(reference_portals_dir.glob("*.png"))
    sig = tuple(f"{p.name}:{p.stat().st_size}" for p in png_files)
    key = str(reference_portals_dir.resolve())
    cached = _PORTAL_REF_CACHE.get(key)
    if cached is not None and cached[0] == sig:
        return cached[1]

    refs: list[dict] = []
    for ref_png in png_files:
        ref_bgr = cv2.imread(str(ref_png))
        if ref_bgr is None:
            continue
        ref_small = cv2.resize(ref_bgr, (_SIM_W, _SIM_H), interpolation=cv2.INTER_AREA)
        ref_gray = cv2.cvtColor(ref_small, cv2.COLOR_BGR2GRAY)
        ref_edge = _edge_magnitude(ref_gray)
        ref_hist, ref_hsv = _nonwhite_hsv_hist(ref_small)
        ref_active = (ref_edge > 14) | (ref_hsv[:, :, 1] > 24) | (ref_hsv[:, :, 2] < 225)
        ref_edge_active = ref_edge > 14

        portal_name = ref_png.stem
        official_domain = ""
        meta_json = ref_png.with_suffix(".json")
        if meta_json.exists():
            try:
                meta = json.loads(meta_json.read_text(encoding="utf-8"))
                portal_name = meta.get("portal_name", ref_png.stem)
                official_domain = str(meta.get("official_domain", ""))
            except Exception:
                portal_name = ref_png.stem

        refs.append(
            {
                "id": ref_png.stem,
                "portal_name": portal_name,
                "official_domain": official_domain,
                "gray_stats": _precompute_ssim_stats(ref_gray),
                "edge_stats": _precompute_ssim_stats(ref_edge),
                "hist": ref_hist,
                "active": ref_active,
                "edge_active": ref_edge_active,
            }
        )

    _PORTAL_REF_CACHE[key] = (sig, refs)
    return refs


def compute_visual_similarity(
    captured_img_path: Union[str, Path],
    reference_portals_dir: Optional[Union[str, Path]] = None,
    min_impersonation_score: float = 52.0,
) -> dict[str, Union[float, str, None]]:
    """
    Compare a captured screenshot or uploaded image against all official portal
    templates in `app/reference_db/portals/` using:
      1. Active-Region Luminance SSIM (ignores empty white-on-white padding)
      2. Sobel Edge Structural SSIM (verifies actual UI layout alignment)
      3. Non-White HSV Palette Correlation
      4. Aspect-Ratio Compatibility Guard (prevents vertical posters from falsely
         matching 16:9 desktop portals).
    """
    if reference_portals_dir is None:
        reference_portals_dir = Path(__file__).resolve().parent.parent / "reference_db" / "portals"
    else:
        reference_portals_dir = Path(reference_portals_dir)

    captured_bgr = cv2.imread(str(captured_img_path))
    if captured_bgr is None or not reference_portals_dir.exists():
        return {
            "visual_similarity_score": 0.0,
            "impersonated_target": None,
            "matched_reference_id": None,
        }

    cap_h, cap_w = captured_bgr.shape[:2]
    cap_ar = float(cap_w) / float(max(1, cap_h))

    # Reference portals are 1280x720 (ar ~ 1.78). Penalize extreme portrait aspect mismatch.
    ref_ar = 1280.0 / 720.0
    ar_diff = abs(math.log(max(0.2, cap_ar) / ref_ar))
    ar_factor = 1.0 if ar_diff <= 0.25 else max(0.50, 1.0 - 0.55 * (ar_diff - 0.25))

    cap_small = cv2.resize(captured_bgr, (_SIM_W, _SIM_H), interpolation=cv2.INTER_AREA)
    cap_gray = cv2.cvtColor(cap_small, cv2.COLOR_BGR2GRAY)
    cap_edge = _edge_magnitude(cap_gray)
    cap_hist, cap_hsv = _nonwhite_hsv_hist(cap_small)
    cap_active = (cap_edge > 14) | (cap_hsv[:, :, 1] > 24) | (cap_hsv[:, :, 2] < 225)
    cap_edge_active = cap_edge > 14

    cap_gray_stats = _precompute_ssim_stats(cap_gray)
    cap_edge_stats = _precompute_ssim_stats(cap_edge)

    best_score = 0.0
    best_portal_name: Optional[str] = None
    best_ref_id: Optional[str] = None

    for ref in _get_cached_portal_refs(reference_portals_dir):
        union_active = cap_active | ref["active"]
        ssim_map = _fast_ssim_map_from_stats(cap_gray_stats, ref["gray_stats"])
        if int(np.count_nonzero(union_active)) >= 125:
            active_lum_ssim = max(0.0, float(np.mean(ssim_map[union_active])))
        else:
            active_lum_ssim = max(0.0, float(np.mean(ssim_map)))

        edge_ssim_map = _fast_ssim_map_from_stats(cap_edge_stats, ref["edge_stats"])
        edge_union = cap_edge_active | ref["edge_active"]
        if int(np.count_nonzero(edge_union)) >= 65:
            edge_ssim = max(0.0, float(np.mean(edge_ssim_map[edge_union])))
        else:
            edge_ssim = max(0.0, float(np.mean(edge_ssim_map)))

        hist_corr = max(0.0, float(cv2.compareHist(cap_hist, ref["hist"], cv2.HISTCMP_CORREL)))

        # Blend: 45% active luminance structure + 30% UI edge structure + 25% non-white color palette
        raw_sim = ((0.45 * active_lum_ssim) + (0.30 * edge_ssim) + (0.25 * hist_corr)) * 100.0
        combined_sim = round(raw_sim * ar_factor, 2)

        if combined_sim > best_score:
            best_score = combined_sim
            best_ref_id = ref["id"]
            best_portal_name = ref["portal_name"]

    final_score = min(100.0, best_score)
    return {
        "visual_similarity_score": final_score,
        "impersonated_target": best_portal_name if final_score >= min_impersonation_score else None,
        "matched_reference_id": best_ref_id,
    }
