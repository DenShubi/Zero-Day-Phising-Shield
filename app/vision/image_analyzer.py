"""
VisiKartika Shield - Multimodal Poster, Screenshot & OCR Visual Analyzer.

Handles non-DOM visual inputs (recruitment posters, flyers, mobile/desktop browser
screenshots, general non-military images) by combining:
  1. Geometry & UI Layout Classification (`POSTER_FLYER`, `MOBILE_SCREENSHOT`, `WEB_SCREENSHOT`)
  2. OpenCV Visual Input-Field / Login-Form Box Detection (for static screenshots)
  3. Cross-Platform OCR Text Extraction (Windows native `Windows.Media.Ocr` + Linux `tesseract` CLI)
  4. Semantic Scam / Calo / Brand-Impersonation vs Safe Non-Military Context Analysis
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional, Union

import cv2
import numpy as np

from app.sandbox.annotator import _draw_label_badge

COLOR_VISUAL_INPUT_AMBER = (0, 165, 255)  # BGR Amber/Orange for visual input boxes on phishing screenshots

# URLs & bare domains printed inside posters or browser address bars
OCR_FULL_URL_RE = re.compile(r"https?://[a-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+", re.IGNORECASE)
OCR_BARE_DOMAIN_RE = re.compile(
    r"\b(?:www\.[a-z0-9-]+(?:\.[a-z0-9-]+)+|[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:mil\.id|go\.id|ac\.id|co\.id|or\.id|com|net|org|id|xyz|info|site|online|top|link|click|vip|icu|me|io|app|pages\.dev|vercel\.app|ngrok-free\.app|trycloudflare\.com|ly))(?:/[a-z0-9._~:/?#\[\]@!$&'()*+,;=%-]*)?",
    re.IGNORECASE,
)

# Military / defence institutional terms (word-boundary matched)
MILITARY_CONTEXT_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("tni", re.compile(r"\btni\b", re.IGNORECASE)),
    ("tniad", re.compile(r"\btni[\s-]*ad\b", re.IGNORECASE)),
    ("angkatan darat", re.compile(r"\bangkatan\s+darat\b", re.IGNORECASE)),
    ("kartika eka paksi", re.compile(r"\bkartika\s+eka\s+paksi\b", re.IGNORECASE)),
    ("pussiberad", re.compile(r"\bpussiber(?:ad)?\b", re.IGNORECASE)),
    ("kemhan", re.compile(r"\b(?:kemhan|kementerian\s+pertahanan)\b", re.IGNORECASE)),
    ("rekrutmen prajurit", re.compile(r"\b(?:penerimaan|rekrutmen)\s+(?:prajurit|bintara|tamtama|taruna|perwira|tni)\b", re.IGNORECASE)),
    ("bintara/tamtama", re.compile(r"\b(?:cata|caba|bintara|tamtama|akmil|seskoad|unhan|kodam|koramil|korem)\b", re.IGNORECASE)),
    ("sisfopers/nrp", re.compile(r"\b(?:sisfopers|nrp)\b", re.IGNORECASE)),
)

# High-risk recruitment scam / calo / credential-phishing / APK malware phrases
SCAM_FRAUD_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("biaya administrasi/pendaftaran", re.compile(r"\bbiaya\s+(?:administrasi|pendaftaran|masuk|seleksi|kesehatan|seragam)\b", re.IGNORECASE)),
    ("jalur khusus / bebas tes", re.compile(r"\b(?:jalur\s+khusus|bebas\s+tes|tanpa\s+tes|kuota\s+khusus|jaminan\s+lulus|pasti\s+lulus|kelulusan\s+100)\b", re.IGNORECASE)),
    ("instruksi transfer rekening", re.compile(r"\b(?:transfer\s+(?:ke\s+)?rekening|no(?:mor)?\s+rek(?:ening)?|uang\s+jaminan|pembayaran\s+loket)\b", re.IGNORECASE)),
    ("file berbahaya (.apk)", re.compile(r"\b\w+\.apk\b", re.IGNORECASE)),
    ("pencurian kode OTP / PIN", re.compile(r"\b(?:kode\s+otp|masukkan\s+pin|verifikasi\s+otp|dana\s+kaget|blokir\s+rekening)\b", re.IGNORECASE)),
)

# Login / credential harvesting UI cues inside OCR text
LOGIN_CREDENTIAL_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("password/kata sandi", re.compile(r"\b(?:password|kata\s+sandi|sandi\s+akun|passcode)\b", re.IGNORECASE)),
    ("login/masuk akun", re.compile(r"\b(?:sign\s+in|log\s*in|masuk\s+akun|verifikasi\s+akun|konfirmasi\s+identitas)\b", re.IGNORECASE)),
    ("identitas NRP/NIK", re.compile(r"\b(?:masukkan\s+nrp|nomor\s+nrp|masukkan\s+nik)\b", re.IGNORECASE)),
)

# Official anti-calo / free-recruitment disclaimer cues on genuine TNI posters
OFFICIAL_DISCLAIMER_RE = re.compile(
    r"\b(?:tidak\s+dipungut\s+biaya|gratis\s+tanpa\s+biaya|hindari\s+calo|waspada\s+penipuan)\b",
    re.IGNORECASE,
)

# Personal WhatsApp/mobile contact solicitation on fake recruitment flyers
PERSONAL_CONTACT_RE = re.compile(
    r"(?:wa|whatsapp|hubungi|cp|contact\s*person|panitia)[\s:.-]*(?:\+?62|08)\d[\d\s-]{7,13}",
    re.IGNORECASE,
)

# Common file extensions that look like domains in OCR noise but are not domains
_IGNORED_DOMAIN_SUFFIXES = (".png", ".jpg", ".jpeg", ".webp", ".svg", ".pdf", ".apk", ".exe", ".zip")


@dataclass
class ImageSemanticAnalysis:
    layout_type: str = "GENERAL_IMAGE"  # POSTER_FLYER | MOBILE_SCREENSHOT | WEB_SCREENSHOT | GENERAL_IMAGE
    aspect_ratio: float = 1.0
    ocr_text: str = ""
    ocr_urls: list[str] = field(default_factory=list)
    military_keywords: list[str] = field(default_factory=list)
    scam_indicators: list[str] = field(default_factory=list)
    login_cues: list[str] = field(default_factory=list)
    has_personal_wa_contact: bool = False
    has_official_free_disclaimer: bool = False
    visual_input_boxes: list[dict[str, int]] = field(default_factory=list)
    has_browser_chrome: bool = False

    @property
    def has_military_context(self) -> bool:
        return bool(self.military_keywords)

    @property
    def has_login_form_cues(self) -> bool:
        return len(self.visual_input_boxes) >= 2 or (
            len(self.visual_input_boxes) >= 1 and bool(self.login_cues)
        ) or len(self.login_cues) >= 2


def classify_image_layout(img_bgr: np.ndarray) -> tuple[str, float, bool]:
    """
    Classify image geometry & top-bar structure into:
      - `POSTER_FLYER`: Portrait/square graphic flyer or announcement poster
      - `MOBILE_SCREENSHOT`: Tall mobile screen (`h/w >= 1.55`) with UI chrome/bars
      - `WEB_SCREENSHOT`: Landscape desktop web capture (`w/h >= 1.22`)
      - `GENERAL_IMAGE`: Arbitrary photo or graphic
    Returns `(layout_type, width_over_height_ratio, has_browser_chrome)`.
    """
    h, w = img_bgr.shape[:2]
    ar = round(float(w) / float(max(1, h)), 3)

    # Check if top 8% of image has a flat horizontal browser/mobile status bar
    top_h = max(16, min(90, int(h * 0.08)))
    top_strip = cv2.cvtColor(img_bgr[:top_h, :], cv2.COLOR_BGR2GRAY)
    row_std = float(np.mean(np.std(top_strip.astype(np.float32), axis=1)))
    edges_top = cv2.Canny(top_strip, 60, 160)
    horiz_line_score = float(np.max(np.mean(edges_top > 0, axis=1))) if edges_top.size else 0.0
    has_browser_chrome = horiz_line_score > 0.35 and row_std < 55.0

    # Check global color saturation to distinguish vivid graphic posters from flat web UIs
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    mean_sat = float(np.mean(hsv[:, :, 1]))

    if ar >= 1.22:
        return "WEB_SCREENSHOT", ar, has_browser_chrome
    if ar <= 0.62 and has_browser_chrome and mean_sat < 95.0:
        return "MOBILE_SCREENSHOT", ar, True
    if ar <= 1.15:
        return "POSTER_FLYER", ar, has_browser_chrome
    return "GENERAL_IMAGE", ar, has_browser_chrome


def detect_visual_input_boxes(img_bgr: np.ndarray) -> list[dict[str, int]]:
    """
    Detect rectangular UI form input fields (`<input>` boxes) in static screenshots
    using edge/contour geometry and vertical alignment clustering.
    """
    h, w = img_bgr.shape[:2]
    if h < 180 or w < 220:
        return []

    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (3, 3), 0)
    edges = cv2.Canny(blurred, 40, 130)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 3))
    closed = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel)

    contours, _ = cv2.findContours(closed, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    raw_boxes: list[dict[str, int]] = []

    min_w = max(110, int(w * 0.14))
    max_w = int(w * 0.82)
    min_h = max(22, int(h * 0.03))
    max_h = min(76, int(h * 0.11))

    for cnt in contours:
        x, y, bw, bh = cv2.boundingRect(cnt)
        # Skip top browser bar & bottom taskbar
        if y < int(h * 0.08) or (y + bh) > int(h * 0.95):
            continue
        if not (min_w <= bw <= max_w and min_h <= bh <= max_h):
            continue
        aspect = float(bw) / float(max(1, bh))
        if not (3.2 <= aspect <= 16.0):
            continue

        peri = cv2.arcLength(cnt, True)
        approx = cv2.approxPolyDP(cnt, 0.03 * peri, True)
        if not (4 <= len(approx) <= 8):
            continue

        rect_area = float(bw * bh)
        cnt_area = float(cv2.contourArea(cnt))
        if cnt_area / max(1.0, rect_area) < 0.72:
            continue

        # Input fields typically have a relatively uniform interior fill
        interior = gray[y + 4 : y + bh - 4, x + 6 : x + bw - 6]
        if interior.size == 0 or float(np.std(interior)) > 42.0:
            continue

        raw_boxes.append({"x": int(x), "y": int(y), "width": int(bw), "height": int(bh)})

    # Deduplicate overlapping contours
    raw_boxes.sort(key=lambda b: (b["y"], b["x"]))
    deduped: list[dict[str, int]] = []
    for box in raw_boxes:
        if any(
            abs(box["x"] - ex["x"]) < 20 and abs(box["y"] - ex["y"]) < 16
            for ex in deduped
        ):
            continue
        deduped.append(box)

    # Genuine login forms usually have vertically aligned fields with similar widths (or 1 clear field)
    if len(deduped) >= 2:
        aligned: list[dict[str, int]] = []
        for i, b1 in enumerate(deduped):
            has_peer = any(
                j != i
                and abs(b1["x"] - b2["x"]) <= 32
                and abs(b1["width"] - b2["width"]) <= 45
                and 8 <= abs(b1["y"] - b2["y"]) <= int(h * 0.35)
                for j, b2 in enumerate(deduped)
            )
            if has_peer:
                aligned.append(b1)
        if aligned:
            return aligned[:6]

    return deduped[:3]


def _extract_ocr_windows_native(image_path: Path) -> str:
    """
    Use Windows 10/11 built-in `Windows.Media.Ocr.OcrEngine` via PowerShell.
    Passes file path strictly through an environment variable (`VK_OCR_IMAGE_PATH`)
    so special characters in filenames are never interpolated into shell syntax.
    """
    ps_script = (
        "$ErrorActionPreference = 'Stop'; "
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; "
        "Add-Type -AssemblyName System.Runtime.WindowsRuntime; "
        "$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { "
        "$_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and "
        "$_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]; "
        "Function Await($WinRtTask, $ResultType) { "
        "$asTask = $asTaskGeneric.MakeGenericMethod($ResultType); "
        "$netTask = $asTask.Invoke($null, @($WinRtTask)); "
        "if (-not $netTask.Wait(3500)) { throw 'OCR timeout' }; $netTask.Result }; "
        "$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]; "
        "$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType=WindowsRuntime]; "
        "$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]; "
        "$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($env:VK_OCR_IMAGE_PATH)) ([Windows.Storage.StorageFile]); "
        "$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream]); "
        "$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder]); "
        "$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap]); "
        "$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages(); "
        "$res = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult]); "
        "Write-Output $res.Text"
    )
    env = os.environ.copy()
    env["VK_OCR_IMAGE_PATH"] = str(image_path.resolve())
    proc = subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps_script],
        env=env,
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="ignore",
        timeout=5.0,
    )
    if proc.returncode == 0:
        return (proc.stdout or "").strip()
    return ""


def _extract_ocr_tesseract_cli(image_path: Path) -> str:
    """Use `tesseract` CLI on Linux/Docker or Windows if installed."""
    tesseract_bin = shutil.which("tesseract")
    if not tesseract_bin:
        return ""
    proc = subprocess.run(
        [tesseract_bin, str(image_path.resolve()), "stdout", "--psm", "6"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="ignore",
        timeout=6.0,
    )
    if proc.returncode == 0:
        return (proc.stdout or "").strip()
    return ""


def extract_ocr_text(image_path: Union[str, Path]) -> str:
    """Best-effort fast OCR across Windows (`Windows.Media.Ocr`) and Linux (`tesseract`)."""
    p = Path(image_path)
    if not p.exists():
        return ""
    try:
        if sys.platform == "win32":
            txt = _extract_ocr_windows_native(p)
            if txt:
                return txt
        return _extract_ocr_tesseract_cli(p)
    except Exception:
        return ""


def _extract_urls_from_ocr(text: str) -> list[str]:
    if not text:
        return []
    found: list[str] = []

    for m in OCR_FULL_URL_RE.findall(text):
        cleaned = m.rstrip(".,);]*_!?'\"")
        if cleaned.lower().endswith(_IGNORED_DOMAIN_SUFFIXES):
            continue
        if cleaned not in found:
            found.append(cleaned)

    for m in OCR_BARE_DOMAIN_RE.findall(text):
        cleaned = m.rstrip(".,);]*_!?'\"")
        if cleaned.lower().endswith(_IGNORED_DOMAIN_SUFFIXES):
            continue
        normalized = cleaned if "://" in cleaned else f"https://{cleaned}"
        if not any(cleaned.lower() in existing.lower() for existing in found):
            found.append(normalized)

    return found


def analyze_image_semantics(
    image_path: Union[str, Path],
    annotated_path: Optional[Union[str, Path]] = None,
    annotate_inputs_if_suspicious: bool = False,
) -> ImageSemanticAnalysis:
    """
    Run layout classification, visual input box detection, and OCR semantic
    extraction on a poster or screenshot image.
    """
    p = Path(image_path)
    img_bgr = cv2.imread(str(p))
    if img_bgr is None:
        return ImageSemanticAnalysis()

    layout_type, ar, has_chrome = classify_image_layout(img_bgr)
    input_boxes = detect_visual_input_boxes(img_bgr) if layout_type != "POSTER_FLYER" else []
    ocr_text = extract_ocr_text(p)

    ocr_urls = _extract_urls_from_ocr(ocr_text)
    mil_kws = [label for label, pat in MILITARY_CONTEXT_PATTERNS if pat.search(ocr_text)]
    scam_hits = [label for label, pat in SCAM_FRAUD_PATTERNS if pat.search(ocr_text)]
    login_hits = [label for label, pat in LOGIN_CREDENTIAL_PATTERNS if pat.search(ocr_text)]
    has_wa_contact = bool(PERSONAL_CONTACT_RE.search(ocr_text))
    has_free_disclaimer = bool(OFFICIAL_DISCLAIMER_RE.search(ocr_text))

    analysis = ImageSemanticAnalysis(
        layout_type=layout_type,
        aspect_ratio=ar,
        ocr_text=ocr_text,
        ocr_urls=ocr_urls,
        military_keywords=mil_kws,
        scam_indicators=scam_hits,
        login_cues=login_hits,
        has_personal_wa_contact=has_wa_contact,
        has_official_free_disclaimer=has_free_disclaimer,
        visual_input_boxes=input_boxes,
        has_browser_chrome=has_chrome,
    )

    if (
        annotate_inputs_if_suspicious
        and annotated_path is not None
        and input_boxes
        and (analysis.has_military_context or analysis.scam_indicators or analysis.login_cues)
    ):
        ann_img = cv2.imread(str(annotated_path))
        if ann_img is not None:
            for idx, b in enumerate(input_boxes[:4], start=1):
                x1, y1 = b["x"], b["y"]
                x2, y2 = x1 + b["width"], y1 + b["height"]
                cv2.rectangle(ann_img, (x1, y1), (x2, y2), COLOR_VISUAL_INPUT_AMBER, thickness=2)
                if idx == 1:
                    _draw_label_badge(
                        ann_img,
                        "VISUAL UI: FORM INPUT LOGIN",
                        x1,
                        y1,
                        COLOR_VISUAL_INPUT_AMBER,
                    )
            cv2.imwrite(str(annotated_path), ann_img)

    return analysis

