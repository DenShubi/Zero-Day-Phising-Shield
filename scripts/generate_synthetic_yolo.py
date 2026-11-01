"""
Synthetic YOLOv8 Logo Dataset Generator for VisiKartika Shield.

Generates synthetic 1280x720 webpage captures with pasted TNI AD / Kartika Eka
Paksi / PUSSIBERAD logos at randomized scales and positions, automatically
emitting normalized YOLOv8 `.txt` bounding-box label files without manual
annotation.
"""

import argparse
import os
import random
from pathlib import Path

import cv2
import numpy as np


def generate_synthetic_yolo_data(
    logo_dir: Path,
    bg_dir: Path,
    output_dir: Path,
    num_samples: int = 100,
) -> int:
    images_out = output_dir / "images"
    labels_out = output_dir / "labels"
    images_out.mkdir(parents=True, exist_ok=True)
    labels_out.mkdir(parents=True, exist_ok=True)

    logos = sorted([p for p in logo_dir.glob("*.png")])
    bgs = sorted(
        [p for p in bg_dir.glob("*.*") if p.suffix.lower() in (".png", ".jpg", ".jpeg")]
    )

    if not logos:
        raise FileNotFoundError(f"No logo PNG templates found in {logo_dir}")

    created = 0
    for i in range(num_samples):
        logo_path = random.choice(logos)
        class_id = logos.index(logo_path)

        if bgs:
            bg = cv2.imread(str(random.choice(bgs)))
            bg = cv2.resize(bg, (1280, 720))
        else:
            # Generate synthetic dark/light web background if no bg images provided
            bg = np.full((720, 1280, 3), random.randint(15, 240), dtype=np.uint8)

        logo = cv2.imread(str(logo_path), cv2.IMREAD_UNCHANGED)
        if logo is None:
            continue

        scale = random.uniform(50, 180) / max(logo.shape[:2])
        new_w = max(24, int(logo.shape[1] * scale))
        new_h = max(24, int(logo.shape[0] * scale))
        logo_resized = cv2.resize(logo, (new_w, new_h))

        max_x = max(21, 1280 - new_w - 20)
        max_y = max(21, 400 - new_h)
        x_offset = random.randint(20, max_x)
        y_offset = random.randint(20, max_y)

        if logo_resized.ndim == 3 and logo_resized.shape[2] == 4:
            alpha = logo_resized[:, :, 3] / 255.0
            for c in range(3):
                bg[y_offset : y_offset + new_h, x_offset : x_offset + new_w, c] = (
                    alpha * logo_resized[:, :, c]
                    + (1.0 - alpha) * bg[y_offset : y_offset + new_h, x_offset : x_offset + new_w, c]
                )
        else:
            bg[y_offset : y_offset + new_h, x_offset : x_offset + new_w] = logo_resized[:, :, :3]

        x_center = (x_offset + new_w / 2.0) / 1280.0
        y_center = (y_offset + new_h / 2.0) / 720.0
        norm_w = new_w / 1280.0
        norm_h = new_h / 720.0

        img_file = images_out / f"synth_{i:04d}.jpg"
        lbl_file = labels_out / f"synth_{i:04d}.txt"
        cv2.imwrite(str(img_file), bg)
        lbl_file.write_text(
            f"{class_id} {x_center:.6f} {y_center:.6f} {norm_w:.6f} {norm_h:.6f}\n",
            encoding="utf-8",
        )
        created += 1

    classes_file = output_dir / "classes.txt"
    classes_file.write_text("\n".join(p.stem for p in logos) + "\n", encoding="utf-8")
    return created


if __name__ == "__main__":
    base_dir = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description="Generate synthetic YOLOv8 logo dataset")
    parser.add_argument("--samples", type=int, default=50, help="Number of synthetic images to generate")
    args = parser.parse_args()

    count = generate_synthetic_yolo_data(
        logo_dir=base_dir / "app" / "reference_db" / "logos",
        bg_dir=base_dir / "storage" / "screenshots",
        output_dir=base_dir / "storage" / "synthetic_yolo",
        num_samples=args.samples,
    )
    print(f"[OK] Generated {count} synthetic YOLOv8 samples in storage/synthetic_yolo/")

