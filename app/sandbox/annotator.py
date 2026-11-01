from pathlib import Path
from typing import Sequence, Union
import cv2
import numpy as np

from app.models import FormElement, InputElement


COLOR_FORM_ORANGE = (0, 165, 255)   # BGR Orange
COLOR_INPUT_RED = (68, 68, 239)     # BGR Red
COLOR_TEXT_WHITE = (255, 255, 255)


def _draw_dashed_rect(
    img: np.ndarray,
    pt1: tuple[int, int],
    pt2: tuple[int, int],
    color: tuple[int, int, int],
    thickness: int = 2,
    dash_length: int = 10,
) -> None:
    x1, y1 = pt1
    x2, y2 = pt2

    # Top and bottom horizontal edges
    for x in range(x1, x2, dash_length * 2):
        x_end = min(x + dash_length, x2)
        cv2.line(img, (x, y1), (x_end, y1), color, thickness)
        cv2.line(img, (x, y2), (x_end, y2), color, thickness)

    # Left and right vertical edges
    for y in range(y1, y2, dash_length * 2):
        y_end = min(y + dash_length, y2)
        cv2.line(img, (x1, y), (x1, y_end), color, thickness)
        cv2.line(img, (x2, y), (x2, y_end), color, thickness)


def _draw_label_badge(
    img: np.ndarray,
    text: str,
    x: int,
    y: int,
    bg_color: tuple[int, int, int],
) -> None:
    font = cv2.FONT_HERSHEY_SIMPLEX
    font_scale = 0.48
    thickness = 1
    (text_w, text_h), baseline = cv2.getTextSize(text, font, font_scale, thickness)

    pad_x, pad_y = 6, 4
    badge_h = text_h + baseline + (pad_y * 2)
    badge_w = text_w + (pad_x * 2)

    top_y = max(0, y - badge_h)
    bot_y = top_y + badge_h
    left_x = max(0, min(x, img.shape[1] - badge_w))
    right_x = min(img.shape[1], left_x + badge_w)

    cv2.rectangle(img, (left_x, top_y), (right_x, bot_y), bg_color, -1)
    cv2.putText(
        img,
        text,
        (left_x + pad_x, bot_y - pad_y - baseline // 2),
        font,
        font_scale,
        COLOR_TEXT_WHITE,
        thickness,
        cv2.LINE_AA,
    )


def draw_dom_annotations(
    screenshot_path: Union[str, Path],
    annotated_path: Union[str, Path],
    forms: Sequence[FormElement],
    inputs: Sequence[InputElement],
) -> str:
    """
    Draw bounding boxes on the raw viewport capture for detected DOM forms and
    sensitive credential input fields.
    """
    screenshot_str = str(screenshot_path)
    annotated_str = str(annotated_path)

    Path(annotated_str).parent.mkdir(parents=True, exist_ok=True)

    img = cv2.imread(screenshot_str)
    if img is None:
        raise FileNotFoundError(f"Unable to read screenshot image at: {screenshot_str}")

    img_h, img_w = img.shape[:2]

    # 1. Draw detected <form> bounding boxes in Orange (dashed rectangle)
    for form in forms:
        bbox = form.bbox
        if bbox.width <= 0 or bbox.height <= 0:
            continue
        x1 = max(0, min(bbox.x, img_w - 1))
        y1 = max(0, min(bbox.y, img_h - 1))
        x2 = max(0, min(bbox.x + bbox.width, img_w - 1))
        y2 = max(0, min(bbox.y + bbox.height, img_h - 1))

        _draw_dashed_rect(img, (x1, y1), (x2, y2), COLOR_FORM_ORANGE, thickness=2, dash_length=12)
        _draw_label_badge(img, "FORM EXFIL", x1, y1, COLOR_FORM_ORANGE)

    # 2. Draw sensitive <input> bounding boxes in Red (solid rectangle)
    for inp in inputs:
        if not inp.is_sensitive_credential:
            continue
        bbox = inp.bbox
        if bbox.width <= 0 or bbox.height <= 0:
            continue
        x1 = max(0, min(bbox.x, img_w - 1))
        y1 = max(0, min(bbox.y, img_h - 1))
        x2 = max(0, min(bbox.x + bbox.width, img_w - 1))
        y2 = max(0, min(bbox.y + bbox.height, img_h - 1))

        cv2.rectangle(img, (x1, y1), (x2, y2), COLOR_INPUT_RED, thickness=2)
        ident = inp.name or inp.id or inp.type or "credential"
        label = f"INPUT: {inp.type}/{ident}"
        _draw_label_badge(img, label, x1, y1, COLOR_INPUT_RED)

    cv2.imwrite(annotated_str, img)
    return annotated_str
