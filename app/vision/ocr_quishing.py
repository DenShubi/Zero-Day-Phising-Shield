from pathlib import Path
from typing import Any, Union

import cv2
import numpy as np

from app.models import BoundingBox
from app.sandbox.annotator import _draw_label_badge

COLOR_QR_MAGENTA = (210, 40, 210)  # BGR Magenta for QR Quishing bounding boxes


def detect_and_annotate_qr_codes(
    image_path: Union[str, Path],
    annotated_path: Union[str, Path],
) -> list[dict[str, Any]]:
    """
    Detect and decode QR codes in an uploaded screenshot or recruitment poster
    (Quishing detection) using OpenCV QRCodeDetector (with multi-pass preprocessing)
    and optional pyzbar fallback. Draws bounding boxes onto `annotated_path`.
    """
    raw_img = cv2.imread(str(image_path))
    ann_img = cv2.imread(str(annotated_path))
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

    passes: list[tuple[np.ndarray, float]] = [
        (raw_img, 1.0),
        (gray, 1.0),
        (otsu, 1.0),
    ]
    if max(img_h, img_w) < 900:
        upscaled = cv2.resize(raw_img, (img_w * 2, img_h * 2), interpolation=cv2.INTER_CUBIC)
        passes.append((upscaled, 0.5))

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

                    found_qrs.append({"payload": clean_text, "bbox": bbox})
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
                    found_qrs.append({"payload": clean_text, "bbox": bbox})
            except Exception:
                pass

    # Optional pyzbar fallback if installed
    if not found_qrs:
        try:
            from pyzbar.pyzbar import decode as pyzbar_decode  # type: ignore

            for obj in pyzbar_decode(raw_img):
                clean_text = obj.data.decode("utf-8", errors="ignore").strip()
                if not clean_text or clean_text in seen_payloads:
                    continue
                seen_payloads.add(clean_text)
                r = obj.rect
                bbox = BoundingBox(
                    x=max(0, int(r.left)),
                    y=max(0, int(r.top)),
                    width=max(16, int(r.width)),
                    height=max(16, int(r.height)),
                ).model_dump()
                found_qrs.append({"payload": clean_text, "bbox": bbox})
        except Exception:
            pass

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
