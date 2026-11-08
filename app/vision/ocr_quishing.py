import os
from pathlib import Path
from typing import Any, Optional, Union

import cv2
import numpy as np

from app.models import BoundingBox
from app.sandbox.annotator import _draw_label_badge

COLOR_QR_MAGENTA = (210, 40, 210)  # BGR Magenta for QR Quishing bounding boxes

_PYZBAR_AVAILABLE: Optional[bool] = None


def is_pyzbar_installed() -> bool:
    import importlib.util

    return importlib.util.find_spec("pyzbar") is not None


def is_pyzbar_available() -> bool:
    """Return True if `pyzbar` and its underlying `libzbar` shared library load cleanly."""
    global _PYZBAR_AVAILABLE
    if _PYZBAR_AVAILABLE is not None:
        return _PYZBAR_AVAILABLE
    try:
        import importlib.util

        spec = importlib.util.find_spec("pyzbar")
        if spec and spec.origin and hasattr(os, "add_dll_directory"):
            os.add_dll_directory(os.path.dirname(spec.origin))
        from pyzbar.pyzbar import decode as _test_decode  # type: ignore  # noqa: F401

        _PYZBAR_AVAILABLE = True
    except Exception:
        _PYZBAR_AVAILABLE = False
    return _PYZBAR_AVAILABLE


def _decode_with_pyzbar_passes(
    passes: list[tuple[np.ndarray, float]],
    img_w: int,
    img_h: int,
    seen_payloads: set[str],
) -> list[dict[str, Any]]:
    """Multi-pass `PyZbar` QR decoder supporting rotated, low-contrast, and small poster QR codes."""
    if not is_pyzbar_available():
        return []
    results: list[dict[str, Any]] = []
    try:
        from pyzbar.pyzbar import ZBarSymbol, decode as pyzbar_decode  # type: ignore

        for candidate_img, coord_scale in passes:
            decoded_objs = pyzbar_decode(candidate_img, symbols=[ZBarSymbol.QRCODE])
            for obj in decoded_objs:
                clean_text = obj.data.decode("utf-8", errors="ignore").strip()
                if not clean_text or clean_text in seen_payloads:
                    continue
                seen_payloads.add(clean_text)

                if getattr(obj, "polygon", None) and len(obj.polygon) >= 4:
                    xs = [p.x * coord_scale for p in obj.polygon]
                    ys = [p.y * coord_scale for p in obj.polygon]
                    x1 = max(0, int(min(xs)))
                    y1 = max(0, int(min(ys)))
                    x2 = min(img_w, int(max(xs)))
                    y2 = min(img_h, int(max(ys)))
                else:
                    r = obj.rect
                    x1 = max(0, int(r.left * coord_scale))
                    y1 = max(0, int(r.top * coord_scale))
                    x2 = min(img_w, int((r.left + r.width) * coord_scale))
                    y2 = min(img_h, int((r.top + r.height) * coord_scale))

                bbox = BoundingBox(
                    x=x1,
                    y=y1,
                    width=max(16, x2 - x1),
                    height=max(16, y2 - y1),
                ).model_dump()
                results.append({"payload": clean_text, "bbox": bbox, "decoder": "pyzbar"})
            if results:
                break
    except Exception:
        pass
    return results


def detect_and_annotate_qr_codes(
    image_path: Union[str, Path],
    annotated_path: Union[str, Path],
) -> list[dict[str, Any]]:
    """
    Detect and decode QR codes in an uploaded screenshot or recruitment poster
    (Quishing detection) using OpenCV QRCodeDetector + PyZbar multi-pass hybrid
    decoding. Draws bounding boxes onto `annotated_path`.
    """
    raw_img = cv2.imread(str(image_path))
    ann_p = Path(annotated_path)
    ann_img = cv2.imread(str(ann_p)) if ann_p.exists() else None
    if raw_img is None:
        return []
    if ann_img is None:
        ann_img = raw_img.copy()

    img_h, img_w = raw_img.shape[:2]
    qr_detector = cv2.QRCodeDetector()
    found_qrs: list[dict[str, Any]] = []
    seen_payloads: set[str] = set()

    gray = cv2.cvtColor(raw_img, cv2.COLOR_BGR2GRAY)
    _, otsu = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
    lap_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())

    passes: list[tuple[np.ndarray, float]] = [
        (raw_img, 1.0),
        (gray, 1.0),
        (otsu, 1.0),
    ]
    if lap_var < 260.0:
        blur_g = cv2.GaussianBlur(gray, (0, 0), 1.5)
        sharp_g = cv2.addWeighted(gray, 1.9, blur_g, -0.9, 0)
        _, sharp_otsu = cv2.threshold(sharp_g, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
        passes.append((sharp_g, 1.0))
        passes.append((sharp_otsu, 1.0))

    if max(img_h, img_w) < 900 or lap_var < 260.0:
        upscaled = cv2.resize(raw_img, (img_w * 2, img_h * 2), interpolation=cv2.INTER_CUBIC)
        blur_up = cv2.GaussianBlur(upscaled, (0, 0), 1.4)
        sharp_up = cv2.addWeighted(upscaled, 1.85, blur_up, -0.85, 0)
        up_gray = cv2.cvtColor(sharp_up, cv2.COLOR_BGR2GRAY)
        _, up_otsu = cv2.threshold(up_gray, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
        passes.append((sharp_up, 0.5))
        passes.append((up_otsu, 0.5))

    if max(img_h, img_w) < 480:
        up3 = cv2.resize(raw_img, (img_w * 3, img_h * 3), interpolation=cv2.INTER_CUBIC)
        blur_up3 = cv2.GaussianBlur(up3, (0, 0), 1.5)
        sharp_up3 = cv2.addWeighted(up3, 1.9, blur_up3, -0.9, 0)
        up3_gray = cv2.cvtColor(sharp_up3, cv2.COLOR_BGR2GRAY)
        _, up3_otsu = cv2.threshold(up3_gray, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
        passes.append((sharp_up3, 1.0 / 3.0))
        passes.append((up3_otsu, 1.0 / 3.0))

    prefer_pyzbar = os.environ.get("VK_QR_BACKEND", "").strip().lower() == "pyzbar"
    if prefer_pyzbar:
        found_qrs.extend(_decode_with_pyzbar_passes(passes, img_w, img_h, seen_payloads))

    if not found_qrs:
        for candidate_img, coord_scale in passes:
            try:
                retval, decoded_info, points, _ = qr_detector.detectAndDecodeMulti(candidate_img)
                if retval and decoded_info is not None and points is not None:
                    for text, pts in zip(decoded_info, points):
                        clean_text = (text or "").strip()
                        if not clean_text or clean_text in seen_payloads:
                            continue
                        seen_payloads.add(clean_text)

                        pts_scaled = pts * coord_scale
                        xs = pts_scaled[:, 0]
                        ys = pts_scaled[:, 1]
                        x1 = max(0, int(np.min(xs)))
                        y1 = max(0, int(np.min(ys)))
                        x2 = min(img_w, int(np.max(xs)))
                        y2 = min(img_h, int(np.max(ys)))

                        bbox = BoundingBox(
                            x=x1,
                            y=y1,
                            width=max(16, x2 - x1),
                            height=max(16, y2 - y1),
                        ).model_dump()

                        found_qrs.append({"payload": clean_text, "bbox": bbox, "decoder": "opencv"})
            except Exception:
                pass

            # Single-QR fallback if detectAndDecodeMulti missed a single code
            if not found_qrs:
                try:
                    text, pts, _ = qr_detector.detectAndDecode(candidate_img)
                    clean_text = (text or "").strip()
                    if clean_text and clean_text not in seen_payloads and pts is not None:
                        seen_payloads.add(clean_text)
                        pts_scaled = pts.reshape(-1, 2) * coord_scale
                        xs = pts_scaled[:, 0]
                        ys = pts_scaled[:, 1]
                        x1 = max(0, int(np.min(xs)))
                        y1 = max(0, int(np.min(ys)))
                        x2 = min(img_w, int(np.max(xs)))
                        y2 = min(img_h, int(np.max(ys)))
                        bbox = BoundingBox(
                            x=x1,
                            y=y1,
                            width=max(16, x2 - x1),
                            height=max(16, y2 - y1),
                        ).model_dump()
                        found_qrs.append({"payload": clean_text, "bbox": bbox, "decoder": "opencv"})
                except Exception:
                    pass

    # Multi-pass PyZbar fallback for skewed/stylized QR codes missed by OpenCV
    if not found_qrs and not prefer_pyzbar:
        found_qrs.extend(_decode_with_pyzbar_passes(passes, img_w, img_h, seen_payloads))

    # Annotate detected QR codes onto annotated_path
    for qr in found_qrs:
        b = qr["bbox"]
        x1, y1 = b["x"], b["y"]
        x2, y2 = x1 + b["width"], y1 + b["height"]
        cv2.rectangle(ann_img, (x1, y1), (x2, y2), COLOR_QR_MAGENTA, thickness=3)
        short_payload = qr["payload"]
        if len(short_payload) > 38:
            short_payload = short_payload[:35] + "..."
        _draw_label_badge(
            ann_img,
            f"QR QUISHING: {short_payload}",
            x1,
            y1,
            COLOR_QR_MAGENTA,
        )

    if found_qrs:
        cv2.imwrite(str(annotated_path), ann_img)

    return found_qrs
