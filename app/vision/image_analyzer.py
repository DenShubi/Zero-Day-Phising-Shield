"""
VisiKartika Shield - Multimodal Poster, Screenshot & OCR Visual Analyzer.

Handles non-DOM visual inputs (recruitment posters, flyers, mobile/desktop browser
screenshots, general non-military images) by combining:
  1. Geometry & UI Layout Classification (`POSTER_FLYER`, `MOBILE_SCREENSHOT`, `WEB_SCREENSHOT`)
  2. OpenCV Visual Input-Field / Login-Form Box Detection (for static screenshots)
  3. Cross-Platform OCR Text Extraction (Persistent Warm Windows `Windows.Media.Ocr` worker + Linux `tesseract` CLI)
  4. Semantic Scam / Calo / Brand-Impersonation vs Safe Non-Military Context Analysis
"""

from __future__ import annotations

import atexit
import base64
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
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

# Military / defence institutional terms (word-boundary matched, with blurry-OCR I/l/1 glyph tolerance)
MILITARY_CONTEXT_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("tni", re.compile(r"\btn[il1]\b", re.IGNORECASE)),
    ("tniad", re.compile(r"(?:\b|pi)t(?:n[il1]|ill)[\s-]*ad\b", re.IGNORECASE)),
    ("angkatan darat", re.compile(r"\bangkatan\s+darat\b", re.IGNORECASE)),
    ("kartika eka paksi", re.compile(r"\bkartika\s+eka\s+paksi\b", re.IGNORECASE)),
    ("pussiberad", re.compile(r"\bpussiber(?:ad)?\b", re.IGNORECASE)),
    ("kemhan", re.compile(r"\b(?:kemhan|kementerian\s+pertahanan)\b", re.IGNORECASE)),
    ("rekrutmen prajurit", re.compile(r"\b(?:penerimaan|rekrutmen)\s+(?:prajurit|bintara|tamtama|taruna|perwira|tn[il1])\b", re.IGNORECASE)),
    ("bintara/tamtama", re.compile(r"\b(?:cata|caba|bintara|tamtama|akmil|seskoad|unhan|kodam|kodim|makodim|koramil|korem|dirgahayu\s+tn[il1]|hut\s+tn[il1]|(?:patriot\s+)?nkr[il1]\b|(?:patriot\s+)?nkr')", re.IGNORECASE)),
    ("sisfopers/nrp", re.compile(r"\b(?:sisfopers|nrp)\b", re.IGNORECASE)),
)

# Landscape banner/poster event typography cues (used to distinguish graphic banners from web screenshots)
POSTER_BANNER_OCR_RE = re.compile(
    r"\b(?:dirgahayu|ikuti\s+dan\s+meriahkan|meriahkan\s+rangkaian|rangkaian\s+kegiatan|donor\s+darah|pasar\s+murah|olahraga\s+bersama|hut\s+tni)\b",
    re.IGNORECASE,
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

# OCR glyph-noise repair for stylized uppercase '.MIL.ID' read as '.HIL.ID' / '.NIL.ID'
_OCR_MIL_GLYPH_FIX_RE = re.compile(r"\b([a-z0-9-]+)\.(?:hil|nil)\.id\b", re.IGNORECASE)
# OCR '@' misread as 'a'/'q' on institutional email footers (e.g. 'humas@bnpt.go.id' -> 'humasabnpt.go.id')
_OCR_EMAIL_AT_MISREAD_RE = re.compile(
    r"^(?:https?://)?(?:humas|info|admin|kontak|ppid|puspen|dispen|pengaduan|redaksi|sekretariat|panitia)[aq]"
    r"((?:[a-z0-9-]+\.)+(?:mil\.id|go\.id|ac\.id))$",
    re.IGNORECASE,
)


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

    top_h = max(16, min(90, int(h * 0.08)))
    top_strip = cv2.cvtColor(img_bgr[:top_h, :], cv2.COLOR_BGR2GRAY)
    row_std = float(np.mean(np.std(top_strip.astype(np.float32), axis=1)))
    edges_top = cv2.Canny(top_strip, 60, 160)
    horiz_line_score = float(np.max(np.mean(edges_top > 0, axis=1))) if edges_top.size else 0.0
    has_browser_chrome = horiz_line_score > 0.35 and row_std < 55.0

    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    mean_sat = float(np.mean(hsv[:, :, 1]))

    if ar >= 1.22:
        if not has_browser_chrome:
            gray_full = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
            row_stds = np.std(gray_full.astype(np.float32), axis=1)
            uniform_row_ratio = float(np.mean(row_stds < 24.0))
            edges_full = cv2.Canny(gray_full, 50, 150)
            edge_density = float(np.mean(edges_full > 0))
            if uniform_row_ratio < 0.12 and edge_density >= 0.125 and mean_sat >= 55.0:
                return "POSTER_FLYER", ar, False
        return "WEB_SCREENSHOT", ar, has_browser_chrome
    if ar <= 0.62 and has_browser_chrome and mean_sat < 95.0:
        return "MOBILE_SCREENSHOT", ar, True
    if ar <= 1.15:
        return "POSTER_FLYER", ar, has_browser_chrome
    return "GENERAL_IMAGE", ar, has_browser_chrome


def detect_visual_input_boxes(img_bgr: np.ndarray) -> list[dict[str, int]]:
    """
    Detect rectangular UI form input fields (`<input>` boxes) in static screenshots
    using edge/contour geometry and vertical alignment clustering. Supports low-res thumbnails.
    """
    h, w = img_bgr.shape[:2]
    if h < 110 or w < 140:
        return []

    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (3, 3), 0)
    edges = cv2.Canny(blurred, 40, 130)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 3))
    closed = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel)

    contours, _ = cv2.findContours(closed, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    raw_boxes: list[dict[str, int]] = []

    min_w = max(52, int(w * 0.14))
    max_w = int(w * 0.82)
    min_h = max(12, int(h * 0.028))
    max_h = min(76, int(h * 0.12))

    for cnt in contours:
        x, y, bw, bh = cv2.boundingRect(cnt)
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

        interior = gray[y + 4 : y + bh - 4, x + 6 : x + bw - 6]
        if interior.size == 0 or float(np.std(interior)) > 42.0:
            continue

        raw_boxes.append({"x": int(x), "y": int(y), "width": int(bw), "height": int(bh)})

    raw_boxes.sort(key=lambda b: (b["y"], b["x"]))
    deduped: list[dict[str, int]] = []
    for box in raw_boxes:
        if any(
            abs(box["x"] - ex["x"]) < 20 and abs(box["y"] - ex["y"]) < 16
            for ex in deduped
        ):
            continue
        deduped.append(box)

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


class _PersistentWinOcrEngine:
    """
    Persistent PowerShell WinRT OCR worker (`Windows.Media.Ocr.OcrEngine`) that
    avoids the ~800ms .NET/PowerShell cold-start cost on every image scan, cutting
    per-image OCR latency down to ~60-95ms after initial warm-up.
    """

    _PS_SERVER_SCRIPT = (
        "$ErrorActionPreference = 'Stop'; "
        "[Console]::InputEncoding = [System.Text.Encoding]::UTF8; "
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; "
        "Add-Type -AssemblyName System.Runtime.WindowsRuntime; "
        "$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { "
        "$_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and "
        "$_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]; "
        "Function Await($WinRtTask, $ResultType) { "
        "$asTask = $asTaskGeneric.MakeGenericMethod($ResultType); "
        "$netTask = $asTask.Invoke($null, @($WinRtTask)); "
        "if (-not $netTask.Wait(3200)) { throw 'OCR timeout' }; $netTask.Result }; "
        "$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType=WindowsRuntime]; "
        "$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]; "
        "$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages(); "
        "[Console]::Out.WriteLine('READY'); [Console]::Out.Flush(); "
        "while ($true) { "
        "  $line = [Console]::In.ReadLine(); "
        "  if ($null -eq $line -or $line -eq '__EXIT__') { break }; "
        "  $fs = $null; "
        "  try { "
        "    $fs = [System.IO.File]::OpenRead($line.Trim()); "
        "    $stream = [System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($fs); "
        "    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder]); "
        "    $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap]); "
        "    $res = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult]); "
        "    $b64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes([string]$res.Text)); "
        "    [Console]::Out.WriteLine('OK:' + $b64); "
        "  } catch { [Console]::Out.WriteLine('ERR:' + $_.Exception.Message) } "
        "  finally { if ($null -ne $fs) { $fs.Dispose() } }; "
        "  [Console]::Out.Flush(); "
        "}"
    )

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._proc: Optional[subprocess.Popen[str]] = None
        self._out_q: queue.Queue[str] = queue.Queue()
        self._disabled = False

    def _reader_loop(self, proc: subprocess.Popen[str]) -> None:
        try:
            assert proc.stdout is not None
            for line in proc.stdout:
                self._out_q.put(line.rstrip("\r\n"))
        except Exception:
            pass

    def _ensure_started(self) -> bool:
        if self._disabled:
            return False
        if self._proc is not None and self._proc.poll() is None:
            return True

        self._shutdown_unlocked()
        while not self._out_q.empty():
            try:
                self._out_q.get_nowait()
            except queue.Empty:
                break

        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        try:
            proc = subprocess.Popen(
                ["powershell", "-NoProfile", "-NonInteractive", "-Command", self._PS_SERVER_SCRIPT],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
                encoding="utf-8",
                errors="ignore",
                bufsize=1,
                creationflags=creationflags,
            )
            t = threading.Thread(target=self._reader_loop, args=(proc,), daemon=True)
            t.start()
            ready_line = self._out_q.get(timeout=4.0)
            if ready_line.strip() == "READY":
                self._proc = proc
                return True
        except Exception:
            self._disabled = True
        self._shutdown_unlocked()
        return False

    def recognize(self, image_path: Path) -> Optional[str]:
        with self._lock:
            if not self._ensure_started() or self._proc is None or self._proc.stdin is None:
                return None
            try:
                self._proc.stdin.write(str(image_path.resolve()) + "\n")
                self._proc.stdin.flush()
                reply = self._out_q.get(timeout=3.8)
                if reply.startswith("OK:"):
                    b64 = reply[3:]
                    return base64.b64decode(b64).decode("utf-8", errors="ignore").strip() if b64 else ""
                return ""
            except Exception:
                self._shutdown_unlocked()
                return None

    def _shutdown_unlocked(self) -> None:
        proc = self._proc
        self._proc = None
        if proc is None:
            return
        try:
            if proc.stdin:
                proc.stdin.write("__EXIT__\n")
                proc.stdin.flush()
                proc.stdin.close()
        except Exception:
            pass
        try:
            proc.terminate()
            proc.wait(timeout=0.5)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass

    def shutdown(self) -> None:
        with self._lock:
            self._shutdown_unlocked()


_WIN_OCR_WORKER = _PersistentWinOcrEngine()
atexit.register(_WIN_OCR_WORKER.shutdown)


def _extract_ocr_windows_oneshot(image_path: Path) -> str:
    """Fallback one-shot PowerShell WinRT OCR if persistent worker is unavailable."""
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
        timeout=4.5,
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


class _LazyEasyOcrEngine:
    """
    Lazy-loaded Deep Learning `EasyOCR` (`easyocr.Reader(['id', 'en'])`) adapter for
    Phase 4 poster/quishing OCR. Never imported at startup unless explicitly requested
    (`VK_OCR_BACKEND=easyocr`) or needed as fallback when native WinRT / Tesseract OCR
    is unavailable, keeping cold-start memory and warm `< 100ms` latency intact.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._reader: object = None
        self._unavailable = False

    @staticmethod
    def is_installed() -> bool:
        import importlib.util

        return importlib.util.find_spec("easyocr") is not None

    def _get_reader(self) -> object:
        if self._unavailable:
            return None
        if self._reader is not None:
            return self._reader
        with self._lock:
            if self._reader is not None:
                return self._reader
            if self._unavailable:
                return None
            try:
                import torch  # type: ignore

                torch_threads = max(1, int(os.environ.get("TORCH_NUM_THREADS", "2")))
                torch.set_num_threads(torch_threads)
                gpu_pref = os.environ.get("VK_EASYOCR_GPU", "auto").strip().lower()
                if gpu_pref == "auto":
                    use_gpu = bool(torch.cuda.is_available())
                else:
                    use_gpu = gpu_pref in ("1", "true", "yes") and bool(torch.cuda.is_available())

                import easyocr  # type: ignore

                self._reader = easyocr.Reader(["id", "en"], gpu=use_gpu, verbose=False)
                return self._reader
            except Exception:
                self._unavailable = True
                return None

    def recognize(self, image_path: Path) -> str:
        reader = self._get_reader()
        if reader is None:
            return ""
        try:
            import torch  # type: ignore

            with torch.inference_mode():
                lines = reader.readtext(str(image_path.resolve()), detail=0, paragraph=True)  # type: ignore[attr-defined]
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            if isinstance(lines, list):
                return "\n".join(str(item).strip() for item in lines if str(item).strip()).strip()
            return ""
        except Exception:
            return ""


_EASY_OCR_WORKER = _LazyEasyOcrEngine()


def get_vision_capabilities() -> dict[str, object]:
    """Return active QR & OCR multimodal capabilities for `/health` and diagnostics."""
    from app.vision.ocr_quishing import is_pyzbar_available, is_pyzbar_installed

    has_tesseract = shutil.which("tesseract") is not None
    has_easyocr = _LazyEasyOcrEngine.is_installed()
    forced_backend = os.environ.get("VK_OCR_BACKEND", "").strip().lower()

    if forced_backend == "easyocr" and has_easyocr:
        primary_ocr = "easyocr"
    elif sys.platform == "win32" and not _WIN_OCR_WORKER._disabled:
        primary_ocr = "windows_media_ocr_persistent"
    elif has_tesseract:
        primary_ocr = "tesseract_cli"
    elif has_easyocr:
        primary_ocr = "easyocr"
    else:
        primary_ocr = "none"

    import importlib.util

    has_torch = importlib.util.find_spec("torch") is not None
    return {
        "qr_decoders": {
            "opencv_qrcode_multipass": True,
            "pyzbar_installed": is_pyzbar_installed(),
            "pyzbar_native_lib_ready": is_pyzbar_available(),
        },
        "ocr_engines": {
            "primary": primary_ocr,
            "winrt_ocr_available": sys.platform == "win32" and not _WIN_OCR_WORKER._disabled,
            "tesseract_available": has_tesseract,
            "easyocr_installed": has_easyocr,
            "pytorch_installed": has_torch,
            "torch_profile": os.environ.get("VK_TORCH_PROFILE", "slim-none"),
        },
    }


def _extract_ocr_single_pass(p: Path) -> str:
    """Single-pass OCR execution on path `p`."""
    try:
        forced_backend = os.environ.get("VK_OCR_BACKEND", "").strip().lower()
        if forced_backend == "easyocr":
            return _EASY_OCR_WORKER.recognize(p)

        if sys.platform == "win32":
            worker_txt = _WIN_OCR_WORKER.recognize(p)
            if worker_txt is not None:
                if worker_txt or os.environ.get("VK_EASYOCR_FALLBACK", "").strip().lower() not in ("1", "true"):
                    return worker_txt
                if _LazyEasyOcrEngine.is_installed():
                    return _EASY_OCR_WORKER.recognize(p)
                return worker_txt
            if not _WIN_OCR_WORKER._disabled:
                txt = _extract_ocr_windows_oneshot(p)
                if txt:
                    return txt

        tess_txt = _extract_ocr_tesseract_cli(p)
        if tess_txt or shutil.which("tesseract") is not None:
            if tess_txt or os.environ.get("VK_EASYOCR_FALLBACK", "").strip().lower() not in ("1", "true"):
                return tess_txt
        if _LazyEasyOcrEngine.is_installed():
            return _EASY_OCR_WORKER.recognize(p)
        return ""
    except Exception:
        return ""


def _build_degraded_ocr_canvas(img_bgr: np.ndarray, max_dim: int) -> np.ndarray:
    """
    Build a sharpened super-resolution / scale-normalized canvas for degraded,
    low-resolution, or heavily blurred/JPEG-compressed images so OCR engines can
    read both tiny thumbnail text and wide soft-blurred headline strokes.
    """
    h, w = img_bgr.shape[:2]
    if max_dim < 850:
        scale = min(4.5, 1100.0 / float(max(1, max_dim)))
        up = cv2.resize(
            img_bgr,
            (max(1, int(round(w * scale))), max(1, int(round(h * scale)))),
            interpolation=cv2.INTER_CUBIC,
        )
        blur = cv2.GaussianBlur(up, (0, 0), 1.6)
        return cv2.addWeighted(up, 1.8, blur, -0.8, 0)

    # Normal/large dimensions but low Laplacian sharpness (pixelated / blurry upscaled image):
    # Downscaling to 0.55x with INTER_AREA + unsharp mask collapses wide blurry edges into
    # crisp 1-2px strokes for large headlines (primary_txt already ran at 1.0x).
    dw = max(1, int(round(w * 0.55)))
    dh = max(1, int(round(h * 0.55)))
    down = cv2.resize(img_bgr, (dw, dh), interpolation=cv2.INTER_AREA)
    blur_d = cv2.GaussianBlur(down, (0, 0), 1.4)
    return cv2.addWeighted(down, 1.9, blur_d, -0.9, 0)


def extract_ocr_text(image_path: Union[str, Path]) -> str:
    """
    Best-effort fast OCR across Windows (`Windows.Media.Ocr` persistent worker),
    Linux (`tesseract` CLI), and Deep Learning `EasyOCR` (`easyocr.Reader(['id', 'en'])`),
    with automatic unsharp-masked super-resolution recovery for low-resolution or blurry images.
    """
    if os.environ.get("VK_DISABLE_OCR", "").lower() in ("1", "true", "yes"):
        return ""
    p = Path(image_path)
    if not p.exists():
        return ""

    primary_txt = _extract_ocr_single_pass(p)

    try:
        img_bgr = cv2.imread(str(p))
        if img_bgr is None:
            return primary_txt
        h, w = img_bgr.shape[:2]
        max_dim = max(h, w)
        min_dim = min(h, w)
        gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
        lap_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        is_degraded = max_dim < 850 or min_dim < 480 or lap_var < 260.0
        if not is_degraded:
            return primary_txt

        has_strong_signal = len(primary_txt) >= 95 and any(
            pat.search(primary_txt)
            for group in (MILITARY_CONTEXT_PATTERNS, SCAM_FRAUD_PATTERNS, LOGIN_CREDENTIAL_PATTERNS)
            for _, pat in group
        )
        if has_strong_signal:
            return primary_txt

        import tempfile

        enh_canvas = _build_degraded_ocr_canvas(img_bgr, max_dim)
        tmp_path = Path(tempfile.gettempdir()) / f"vk_ocr_enh_{os.getpid()}_{threading.get_ident()}.png"
        try:
            cv2.imwrite(str(tmp_path), enh_canvas)
            enh_txt = _extract_ocr_single_pass(tmp_path)
        finally:
            try:
                tmp_path.unlink(missing_ok=True)
            except Exception:
                pass

        if enh_txt and enh_txt not in primary_txt:
            return f"{primary_txt}\n{enh_txt}".strip() if primary_txt else enh_txt
    except Exception:
        pass
    return primary_txt


def _repair_ocr_domain_token(token: str) -> str:
    """
    Correct well-known optical glyph confusions strictly inside OCR-extracted bare
    domains (never applied to typed URLs or QR payloads):
      1. Stylized uppercase `.MIL.ID` misread as non-existent `.HIL.ID` / `.NIL.ID`
         (plus `REKRUTHEN` -> `rekrutmen`).
      2. Institutional email `@` misread as `a`/`q` (`humas@bnpt.go.id` -> `humasabnpt.go.id`).
    """
    m_email = _OCR_EMAIL_AT_MISREAD_RE.match(token)
    if m_email:
        scheme_prefix = "https://" if "://" in token else ""
        return f"{scheme_prefix}{m_email.group(1).lower()}"

    if _OCR_MIL_GLYPH_FIX_RE.search(token):
        fixed = re.sub(r"\.(?:hil|nil)\.id\b", ".mil.id", token, flags=re.IGNORECASE)
        fixed = re.sub(r"rekruthen", "rekrutmen", fixed, flags=re.IGNORECASE)
        return fixed

    return token


def _extract_urls_from_ocr(text: str) -> list[str]:
    if not text:
        return []
    found: list[str] = []
    # Strip actual email addresses (`user@domain.tld`) before bare-domain scanning
    scrubbed_text = re.sub(r"\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b", " ", text, flags=re.IGNORECASE)

    for m in OCR_FULL_URL_RE.findall(scrubbed_text):
        cleaned = _repair_ocr_domain_token(m.rstrip(".,);]*_!'\""))
        if cleaned.lower().endswith(_IGNORED_DOMAIN_SUFFIXES):
            continue
        if cleaned not in found:
            found.append(cleaned)

    for m in OCR_BARE_DOMAIN_RE.findall(scrubbed_text):
        cleaned = _repair_ocr_domain_token(m.rstrip(".,);]*_!'\""))
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

    if (
        layout_type == "WEB_SCREENSHOT"
        and not has_chrome
        and not input_boxes
        and POSTER_BANNER_OCR_RE.search(ocr_text)
    ):
        layout_type = "POSTER_FLYER"

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
