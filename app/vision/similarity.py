import json
from pathlib import Path
from typing import Optional, Union

import cv2
import numpy as np


def compute_ssim_opencv(img1_gray: np.ndarray, img2_gray: np.ndarray) -> float:
    """
    Compute Structural Similarity Index (SSIM) between two grayscale images
    of identical shape using OpenCV Gaussian filtering (Wang et al., 2004).
    """
    c1 = (0.01 * 255) ** 2
    c2 = (0.03 * 255) ** 2

    i1 = img1_gray.astype(np.float64)
    i2 = img2_gray.astype(np.float64)

    mu1 = cv2.GaussianBlur(i1, (11, 11), 1.5)
    mu2 = cv2.GaussianBlur(i2, (11, 11), 1.5)

    mu1_sq = mu1 * mu1
    mu2_sq = mu2 * mu2
    mu1_mu2 = mu1 * mu2

    sigma1_sq = cv2.GaussianBlur(i1 * i1, (11, 11), 1.5) - mu1_sq
    sigma2_sq = cv2.GaussianBlur(i2 * i2, (11, 11), 1.5) - mu2_sq
    sigma12 = cv2.GaussianBlur(i1 * i2, (11, 11), 1.5) - mu1_mu2

    numerator = (2.0 * mu1_mu2 + c1) * (2.0 * sigma12 + c2)
    denominator = (mu1_sq + mu2_sq + c1) * (sigma1_sq + sigma2_sq + c2)

    ssim_map = numerator / denominator
    return float(np.mean(ssim_map))


def compute_visual_similarity(
    captured_img_path: Union[str, Path],
    reference_portals_dir: Optional[Union[str, Path]] = None,
) -> dict[str, Union[float, str, None]]:
    """
    Compare a captured 1280x720 screenshot against all official portal templates
    in `app/reference_db/portals/` using SSIM + HSV color histogram correlation.
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

    cap_gray = cv2.cvtColor(captured_bgr, cv2.COLOR_BGR2GRAY)
    cap_gray_resized = cv2.resize(cap_gray, (640, 360))

    cap_hsv = cv2.cvtColor(captured_bgr, cv2.COLOR_BGR2HSV)
    cap_hist = cv2.calcHist([cap_hsv], [0, 1], None, [30, 32], [0, 180, 0, 256])
    cv2.normalize(cap_hist, cap_hist, 0, 1, cv2.NORM_MINMAX)

    best_score = 0.0
    best_portal_name: Optional[str] = None
    best_ref_id: Optional[str] = None

    for ref_png in sorted(reference_portals_dir.glob("*.png")):
        ref_bgr = cv2.imread(str(ref_png))
        if ref_bgr is None:
            continue

        ref_gray = cv2.cvtColor(ref_bgr, cv2.COLOR_BGR2GRAY)
        ref_gray_resized = cv2.resize(ref_gray, (640, 360))

        ssim_val = max(0.0, compute_ssim_opencv(cap_gray_resized, ref_gray_resized))

        ref_hsv = cv2.cvtColor(ref_bgr, cv2.COLOR_BGR2HSV)
        ref_hist = cv2.calcHist([ref_hsv], [0, 1], None, [30, 32], [0, 180, 0, 256])
        cv2.normalize(ref_hist, ref_hist, 0, 1, cv2.NORM_MINMAX)
        hist_corr = max(0.0, float(cv2.compareHist(cap_hist, ref_hist, cv2.HISTCMP_CORREL)))

        # Blend 75% structural layout SSIM + 25% palette correlation
        combined_sim = round(((0.75 * ssim_val) + (0.25 * hist_corr)) * 100.0, 2)

        if combined_sim > best_score:
            best_score = combined_sim
            best_ref_id = ref_png.stem
            meta_json = ref_png.with_suffix(".json")
            if meta_json.exists():
                try:
                    meta = json.loads(meta_json.read_text(encoding="utf-8"))
                    best_portal_name = meta.get("portal_name", ref_png.stem)
                except Exception:
                    best_portal_name = ref_png.stem
            else:
                best_portal_name = ref_png.stem

    return {
        "visual_similarity_score": min(100.0, best_score),
        "impersonated_target": best_portal_name,
        "matched_reference_id": best_ref_id,
    }

