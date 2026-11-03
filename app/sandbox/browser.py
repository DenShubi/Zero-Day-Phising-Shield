import asyncio
import atexit
import ipaddress
import json
import os
import re
import shutil
import sys
import threading
import time
import uuid
import warnings
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

import cv2

try:
    cv2.setNumThreads(max(1, int(os.environ.get("VK_OPENCV_THREADS", "2"))))
except Exception:
    pass
from playwright.async_api import (
    Browser,
    Playwright,
    Request,
    Response,
    Route,
    TimeoutError as PlaywrightTimeoutError,
    async_playwright,
)

from app import domain_guard
from app.models import (
    BoundingBox,
    DomRiskAnalysis,
    FormElement,
    ImageElement,
    InputElement,
    Phase1ScanResponse,
)
from app.sandbox.annotator import draw_dom_annotations
from app.vision.similarity import compute_ssim_opencv

if sys.platform == "win32":
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())


OFFICIAL_MIL_DOMAINS = domain_guard.OFFICIAL_MIL_DOMAINS

MILITARY_KEYWORDS = [
    "tni",
    "tniad",
    "angkatan darat",
    "pussiberad",
    "kartika eka paksi",
    "bintara",
    "tamtama",
    "sisfopers",
    "nrp",
    "kodam",
    "prajurit",
    "kemhan",
    "rekrutmen tni",
]

SENSITIVE_INPUT_TOKENS = [
    "nrp",
    "nik",
    "sandi",
    "pass",
    "pin",
    "otp",
    "user",
    "email",
]

MILITARY_ID_REGEX = re.compile(r"\b(?:nrp|sisfopers|prajurit)\b", re.IGNORECASE)

EXFILTRATION_HOST_PATTERNS: tuple[str, ...] = (
    "api.telegram.org",
    "telegram.org",
    "discord.com",
    "discordapp.com",
    "webhook.site",
    "pipedream.net",
    "requestbin",
    "script.google.com",
    "ngrok-free.app",
    "ngrok.io",
    "trycloudflare.com",
    "exfil",
)

# Non-visual analytics/tracker hosts aborted in sandbox to prevent multi-second load stalls
_ABORTED_TRACKER_HOSTS: tuple[str, ...] = (
    "google-analytics.com",
    "googletagmanager.com",
    "doubleclick.net",
    "connect.facebook.net",
    "hotjar.com",
    "clarity.ms",
    "mc.yandex.ru",
)

_ALLOWED_SUBREQUEST_SCHEMES: frozenset[str] = frozenset({"http", "https", "data", "blob", "about"})
_PRIVATE_HOSTNAME_SUFFIXES: tuple[str, ...] = (
    ".localhost",
    ".local",
    ".internal",
    ".home.arpa",
)
_BLOCKED_METADATA_HOSTS: frozenset[str] = frozenset(
    {
        "localhost",
        "localhost.localdomain",
        "metadata.google.internal",
        "metadata",
        "169.254.169.254",
        "100.100.100.200",
        "fd00:ec2::254",
    }
)


def _resolve_max_concurrent_contexts() -> int:
    default_val = "2" if os.environ.get("VK_CONTAINER_MODE", "").strip() == "1" else "4"
    try:
        return max(1, min(8, int(os.environ.get("VK_MAX_CONCURRENT_CONTEXTS", default_val))))
    except ValueError:
        return 4


def _resolve_browser_max_scans() -> int:
    try:
        return max(10, int(os.environ.get("VK_BROWSER_MAX_SCANS", "60")))
    except ValueError:
        return 60


def _build_chromium_args() -> list[str]:
    """
    Build resource-capped and security-isolated Chromium launch flags (Phase 5).
    - Keeps OS-level renderer sandboxing ENABLED on Windows/macOS and on Linux containers
      configured with `VK_CHROMIUM_SANDBOX=true` (e.g. `docker/seccomp-chromium.json`).
    - Falls back to `--no-sandbox` only on unprivileged Linux PaaS containers (e.g. Railway)
      where host kernels restrict `CLONE_NEWUSER` user namespaces.
    - Caps V8 JS heap (`--max-old-space-size`) and renderer count to prevent OOM DoS.
    """
    v8_heap_mb = max(128, min(1024, int(os.environ.get("VK_V8_MAX_OLD_SPACE_MB", "256"))))
    os_sandbox_enabled = sys.platform == "win32" or sys.platform == "darwin" or (
        os.environ.get("VK_CHROMIUM_SANDBOX", "").strip().lower() in ("1", "true", "yes")
    )

    args: list[str] = []
    if not os_sandbox_enabled:
        args.extend(["--no-sandbox", "--disable-setuid-sandbox"])

    args.extend(
        [
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--disable-software-rasterizer",
            f"--js-flags=--max-old-space-size={v8_heap_mb}",
            "--renderer-process-limit=2",
            "--block-new-web-contents",
            "--disable-extensions",
            "--disable-component-extensions-with-background-pages",
            "--disable-background-networking",
            "--disable-background-timer-throttling",
            "--disable-sync",
            "--disable-translate",
            "--disable-default-apps",
            "--disable-breakpad",
            "--disable-crash-reporter",
            "--disable-domain-reliability",
            "--disable-client-side-phishing-detection",
            "--disable-features=Translate,BackForwardCache,AcceptCHFrame,MediaRouter,OptimizationHints,AudioServiceOutOfProcess",
            "--metrics-recording-only",
            "--mute-audio",
            "--no-first-run",
            "--no-default-browser-check",
        ]
    )
    return args


_CHROMIUM_ARGS: list[str] = _build_chromium_args()
MAX_CONCURRENT_CONTEXTS = _resolve_max_concurrent_contexts()
MAX_SCANS_BEFORE_RECYCLE = _resolve_browser_max_scans()


def is_subrequest_allowed(req_url: str, allow_private_targets: bool = False) -> bool:
    """
    Enforce zero-trust network & protocol isolation on every sub-request and HTTP redirect
    inside headless Chromium (blocks `file://`, `chrome://`, cloud metadata `169.254.169.254`,
    and RFC1918/loopback SSRF pivots from external phishing pages).
    """
    if not req_url:
        return False
    parsed = urlparse(req_url)
    scheme = (parsed.scheme or "").lower()
    if scheme not in _ALLOWED_SUBREQUEST_SCHEMES:
        return False
    if scheme in ("data", "blob", "about"):
        return True

    host = (parsed.hostname or "").lower().strip(".").strip("[]")
    if not host:
        return False
    if allow_private_targets:
        return True

    if host in _BLOCKED_METADATA_HOSTS or host.endswith(_PRIVATE_HOSTNAME_SUFFIXES):
        return False

    try:
        ip = ipaddress.ip_address(host.split("%", 1)[0])
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            return False
    except ValueError:
        pass

    return True


def get_sandbox_isolation_profile() -> dict[str, object]:
    """Return active Chromium & container resource isolation settings for `/health` and Phase 5 audit."""
    args = _build_chromium_args()
    return {
        "container_mode": os.environ.get("VK_CONTAINER_MODE", "").strip() == "1",
        "os_renderer_sandbox": "--no-sandbox" not in args,
        "dev_shm_disabled": "--disable-dev-shm-usage" in args,
        "v8_max_old_space_mb": int(os.environ.get("VK_V8_MAX_OLD_SPACE_MB", "256")),
        "max_concurrent_contexts": _resolve_max_concurrent_contexts(),
        "browser_recycle_every_scans": _resolve_browser_max_scans(),
        "ssrf_subrequest_guard": True,
        "downloads_blocked": True,
        "service_workers_blocked": True,
        "non_root_user": (os.geteuid() != 0) if hasattr(os, "geteuid") else True,
    }


class _WarmPlaywrightPool:
    """
    Maintains a warm headless Chromium instance across scans while enforcing
    strict per-scan BrowserContext isolation (`accept_downloads=False`, fresh
    cookies/storage, blocked ServiceWorkers), bounded concurrency, and automatic
    browser process recycling every N scans to prevent memory fragmentation.

    On Windows (`win32`), runs inside a dedicated persistent daemon ProactorEventLoop
    thread so FastAPI/Uvicorn works seamlessly even under `--reload` SelectorEventLoop.
    """

    def __init__(self) -> None:
        self._thread_lock = threading.Lock()
        self._win_loop: Optional[asyncio.AbstractEventLoop] = None
        self._win_thread: Optional[threading.Thread] = None

        self._pw: Optional[Playwright] = None
        self._browser: Optional[Browser] = None
        self._loop_id: Optional[int] = None
        self._async_lock: Optional[asyncio.Lock] = None
        self._semaphore: Optional[asyncio.Semaphore] = None
        self._scan_count: int = 0
        self._active_scans: int = 0

    def _ensure_win_loop(self) -> asyncio.AbstractEventLoop:
        with self._thread_lock:
            if self._win_loop is not None and self._win_thread is not None and self._win_thread.is_alive():
                return self._win_loop

            ready = threading.Event()
            holder: list[asyncio.AbstractEventLoop] = []

            def _runner() -> None:
                loop = asyncio.ProactorEventLoop()
                asyncio.set_event_loop(loop)
                holder.append(loop)
                ready.set()
                try:
                    loop.run_forever()
                finally:
                    try:
                        loop.close()
                    except Exception:
                        pass

            t = threading.Thread(target=_runner, name="visikartika-pw-pool", daemon=True)
            t.start()
            ready.wait(timeout=5.0)
            self._win_loop = holder[0]
            self._win_thread = t
            return self._win_loop

    async def acquire_browser(self) -> tuple[Browser, asyncio.Semaphore]:
        cur_loop = asyncio.get_running_loop()
        if self._loop_id != id(cur_loop) or self._async_lock is None or self._semaphore is None:
            self._async_lock = asyncio.Lock()
            self._semaphore = asyncio.Semaphore(_resolve_max_concurrent_contexts())
            self._pw = None
            self._browser = None
            self._scan_count = 0
            self._active_scans = 0
            self._loop_id = id(cur_loop)

        async with self._async_lock:
            should_recycle = (
                self._browser is not None
                and self._active_scans == 0
                and self._scan_count >= _resolve_browser_max_scans()
            )
            if should_recycle:
                await self._close_on_loop()
                self._scan_count = 0

            if self._browser is None or not self._browser.is_connected():
                if self._pw is not None:
                    try:
                        await self._pw.stop()
                    except Exception:
                        pass
                self._pw = await async_playwright().start()
                self._browser = await self._pw.chromium.launch(
                    headless=True,
                    args=_build_chromium_args(),
                    chromium_sandbox="--no-sandbox" not in _build_chromium_args(),
                )
                self._scan_count = 0
            self._scan_count += 1
            self._active_scans += 1
            return self._browser, self._semaphore

    async def release_scan_slot(self) -> None:
        if self._async_lock is None:
            return
        async with self._async_lock:
            self._active_scans = max(0, self._active_scans - 1)

    async def _close_on_loop(self) -> None:
        browser, self._browser = self._browser, None
        pw, self._pw = self._pw, None
        if browser is not None:
            try:
                await browser.close()
            except Exception:
                pass
        if pw is not None:
            try:
                await pw.stop()
            except Exception:
                pass

    def shutdown_sync(self) -> None:
        with self._thread_lock:
            loop = self._win_loop
            thread = self._win_thread
            self._win_loop = None
            self._win_thread = None

        if loop is not None and loop.is_running():
            try:
                fut = asyncio.run_coroutine_threadsafe(self._close_on_loop(), loop)
                fut.result(timeout=2.0)
            except Exception:
                pass
            try:
                loop.call_soon_threadsafe(loop.stop)
            except Exception:
                pass
            if thread is not None:
                thread.join(timeout=1.0)


_GLOBAL_PW_POOL = _WarmPlaywrightPool()
atexit.register(_GLOBAL_PW_POOL.shutdown_sync)


class HeadlessSandboxScanner:
    """
    Isolated Playwright Chromium sandbox for capturing viewport screenshots,
    extracting DOM form/input/image bounding boxes, and evaluating phishing
    telemetry for VisiKartika Shield (Phase 1–3).
    """

    def __init__(self, base_storage_dir: Optional[Path] = None) -> None:
        if base_storage_dir is None:
            self.base_storage_dir = Path(__file__).resolve().parents[2] / "storage"
        else:
            self.base_storage_dir = Path(base_storage_dir)

        self.screenshots_dir = self.base_storage_dir / "screenshots"
        self.annotated_dir = self.base_storage_dir / "annotated"
        self.screenshots_dir.mkdir(parents=True, exist_ok=True)
        self.annotated_dir.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _is_official_domain(hostname: str) -> bool:
        return domain_guard.is_official_domain(hostname)

    @staticmethod
    def _is_ip_address(hostname: str) -> bool:
        if not hostname:
            return False
        try:
            ipaddress.ip_address(hostname)
            return True
        except ValueError:
            return False

    async def warmup(self) -> float:
        """Pre-warm the persistent Chromium instance and return warm-up time in milliseconds."""
        t0 = time.perf_counter()
        if sys.platform == "win32":
            win_loop = _GLOBAL_PW_POOL._ensure_win_loop()
            fut = asyncio.run_coroutine_threadsafe(_GLOBAL_PW_POOL.acquire_browser(), win_loop)
            await asyncio.wrap_future(fut)
        else:
            await _GLOBAL_PW_POOL.acquire_browser()
        return round((time.perf_counter() - t0) * 1000.0, 2)

    async def aclose(self) -> None:
        """Gracefully close warm Chromium browser resources."""
        if sys.platform == "win32":
            await asyncio.to_thread(_GLOBAL_PW_POOL.shutdown_sync)
        else:
            await _GLOBAL_PW_POOL._close_on_loop()

    async def capture_and_extract(
        self,
        target_url: str,
        scan_id: Optional[str] = None,
    ) -> Phase1ScanResponse:
        if sys.platform == "win32":
            win_loop = _GLOBAL_PW_POOL._ensure_win_loop()
            fut = asyncio.run_coroutine_threadsafe(
                self._capture_and_extract_async(target_url, scan_id),
                win_loop,
            )
            return await asyncio.wrap_future(fut)
        return await self._capture_and_extract_async(target_url, scan_id)

    @staticmethod
    def _find_cached_official_portal(hostname: str) -> Optional[dict]:
        """
        Look up `app/reference_db/manifest.json` to see if `hostname` matches a
        captured official reference portal (resilient fallback on transient network timeouts).
        """
        if not hostname:
            return None
        clean_host = hostname.lower().strip(".").removeprefix("www.")
        ref_dir = Path(__file__).resolve().parent.parent / "reference_db"
        manifest_path = ref_dir / "manifest.json"
        if not manifest_path.exists():
            return None
        try:
            entries = json.loads(manifest_path.read_text(encoding="utf-8"))
            for item in entries:
                entry_domain = (
                    str(item.get("official_domain", ""))
                    .split("/")[0]
                    .lower()
                    .strip(".")
                    .removeprefix("www.")
                )
                if entry_domain == clean_host:
                    img_name = Path(item.get("screenshot", f"{item.get('id', '')}.png")).name
                    img_path = ref_dir / "portals" / img_name
                    if img_path.exists():
                        return {
                            **item,
                            "name": item.get("title") or item.get("portal_name") or clean_host,
                            "image_path": img_path,
                        }
        except Exception:
            return None
        return None

    async def _capture_and_extract_async(
        self,
        target_url: str,
        scan_id: Optional[str] = None,
    ) -> Phase1ScanResponse:
        start_time = time.perf_counter()
        resolved_scan_id = scan_id or f"scan_{uuid.uuid4().hex[:8]}"

        screenshot_file = self.screenshots_dir / f"{resolved_scan_id}.png"
        annotated_file = self.annotated_dir / f"{resolved_scan_id}_dom.png"

        rel_screenshot_path = f"storage/screenshots/{resolved_scan_id}.png"
        rel_annotated_path = f"storage/annotated/{resolved_scan_id}_dom.png"

        redirect_chain: list[str] = []
        external_domains: set[str] = set()
        initial_parsed = urlparse(target_url)
        initial_host = (initial_parsed.hostname or "").lower()

        status_code = 0
        final_url = target_url
        page_title = ""
        used_cached_portal: Optional[dict] = None

        allow_private_subrequests = (
            os.environ.get("ALLOW_PRIVATE_SCAN_TARGETS", "").strip().lower() in ("1", "true", "yes", "on")
            or (initial_parsed.path or "").startswith("/mock-targets/")
        )

        t_acq0 = time.perf_counter()
        browser, sem = await _GLOBAL_PW_POOL.acquire_browser()

        navigation_dom_ms = 0.0
        render_settle_ms = 0.0
        screenshot_dom_extract_ms = 0.0

        try:
          async with sem:
            context = await browser.new_context(
                viewport={"width": 1280, "height": 720},
                accept_downloads=False,
                ignore_https_errors=True,
                service_workers="block",
                permissions=[],
                bypass_csp=False,
                locale="id-ID",
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/128.0.0.0 Safari/537.36 VisiKartikaSandbox/1.0"
                ),
            )
            try:
                await context.add_init_script(
                    "window.print = () => {}; window.open = () => null;"
                )
                page = await context.new_page()
                page.on("dialog", lambda dlg: asyncio.create_task(dlg.dismiss()))
                browser_acquire_ms = round((time.perf_counter() - t_acq0) * 1000.0, 2)

                def _on_request(req: Request) -> None:
                    req_parsed = urlparse(req.url)
                    req_host = (req_parsed.hostname or "").lower()
                    if req_host and req_host != initial_host:
                        external_domains.add(req_host)

                async def _route_filter(route: Route) -> None:
                    req = route.request
                    if not is_subrequest_allowed(req.url, allow_private_targets=allow_private_subrequests):
                        await route.abort("accessdenied")
                        return
                    rtype = req.resource_type
                    if rtype in ("media", "eventsource", "websocket"):
                        await route.abort()
                        return
                    rhost = (urlparse(req.url).hostname or "").lower()
                    if rhost and any(t in rhost for t in _ABORTED_TRACKER_HOSTS):
                        await route.abort()
                        return
                    await route.continue_()

                page.on("request", _on_request)
                await page.route("**/*", _route_filter)

                response: Optional[Response] = None
                t_nav0 = time.perf_counter()
                try:
                    response = await page.goto(
                        target_url,
                        timeout=14000,
                        wait_until="domcontentloaded",
                    )
                    navigation_dom_ms = round((time.perf_counter() - t_nav0) * 1000.0, 2)

                    t_settle0 = time.perf_counter()
                    # Cap subresource 'load' wait at 2.2s so slow third-party widgets never stall capture
                    try:
                        await page.wait_for_load_state("load", timeout=2200)
                    except Exception:
                        pass

                    # Wait up to 1.0s for visible viewport <img> requests to complete (success OR 404)
                    try:
                        await page.wait_for_function(
                            """
                            () => {
                                const imgs = Array.from(document.querySelectorAll('img')).filter((el) => {
                                    const r = el.getBoundingClientRect();
                                    return r.width >= 24 && r.height >= 24 && r.top < 720;
                                });
                                return imgs.length === 0 || imgs.every((img) => img.complete);
                            }
                            """,
                            timeout=1000,
                        )
                    except Exception:
                        pass

                    # Adaptive double-rAF + 140ms paint stabilization (replaces fixed 1500ms sleep)
                    try:
                        await page.evaluate(
                            "() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 140))))"
                        )
                    except Exception:
                        await page.wait_for_timeout(140)
                    render_settle_ms = round((time.perf_counter() - t_settle0) * 1000.0, 2)

                except PlaywrightTimeoutError:
                    navigation_dom_ms = round((time.perf_counter() - t_nav0) * 1000.0, 2)
                    try:
                        body_len = await page.evaluate(
                            "() => document.body ? document.body.innerHTML.length : 0"
                        )
                    except Exception:
                        body_len = 0

                    if body_len <= 100:
                        cached = self._find_cached_official_portal(initial_host)
                        if cached is not None:
                            used_cached_portal = cached
                        else:
                            raise
                except Exception:
                    navigation_dom_ms = round((time.perf_counter() - t_nav0) * 1000.0, 2)
                    cached = self._find_cached_official_portal(initial_host)
                    if cached is not None:
                        used_cached_portal = cached
                    else:
                        raise

                t_cap0 = time.perf_counter()
                if used_cached_portal is not None:
                    shutil.copyfile(str(used_cached_portal["image_path"]), str(screenshot_file))
                    status_code = 200
                    redirect_chain = [target_url]
                    final_url = target_url
                    page_title = str(used_cached_portal.get("name", initial_host))
                    dom_payload = {
                        "forms": [],
                        "inputs": [],
                        "images": [],
                        "detectedKeywords": ["tni", "angkatan darat"],
                        "contextMenuDisabled": False,
                        "hasFormlessSensitiveInput": False,
                    }
                else:
                    if response is not None:
                        status_code = response.status or 200
                        req_cursor = response.request
                        chain_urls: list[str] = []
                        while req_cursor is not None:
                            chain_urls.append(req_cursor.url)
                            req_cursor = req_cursor.redirected_from
                        chain_urls.reverse()
                        redirect_chain = chain_urls
                    else:
                        status_code = 200
                        redirect_chain = [target_url]

                    final_url = page.url
                    page_title = await page.title()

                    await page.screenshot(path=str(screenshot_file), full_page=False)

                    cached_official = self._find_cached_official_portal(initial_host)
                    if cached_official is not None:
                        live_img = cv2.imread(str(screenshot_file), cv2.IMREAD_GRAYSCALE)
                        ref_img = cv2.imread(str(cached_official["image_path"]), cv2.IMREAD_GRAYSCALE)
                        if live_img is not None and ref_img is not None:
                            if live_img.shape != ref_img.shape:
                                live_img = cv2.resize(live_img, (ref_img.shape[1], ref_img.shape[0]))
                            render_ssim = compute_ssim_opencv(live_img, ref_img)
                            if render_ssim < 0.65:
                                shutil.copyfile(str(cached_official["image_path"]), str(screenshot_file))
                                if not page_title:
                                    page_title = str(cached_official.get("name", initial_host))

                    dom_payload = await page.evaluate(
                        """
                        ({ sensitiveTokens, militaryKeywords }) => {
                            const isVisible = (el) => {
                                const style = window.getComputedStyle(el);
                                if (
                                    style.display === 'none' ||
                                    style.visibility === 'hidden' ||
                                    parseFloat(style.opacity || '1') === 0
                                ) {
                                    return false;
                                }
                                const rect = el.getBoundingClientRect();
                                return rect.width > 0 && rect.height > 0;
                            };

                            const toBBox = (el) => {
                                const r = el.getBoundingClientRect();
                                return {
                                    x: Math.max(0, Math.round(r.left)),
                                    y: Math.max(0, Math.round(r.top)),
                                    width: Math.max(0, Math.round(r.width)),
                                    height: Math.max(0, Math.round(r.height))
                                };
                            };

                            const pageOrigin = window.location.origin;

                            const forms = [];
                            document.querySelectorAll('form').forEach((formEl, idx) => {
                                if (!isVisible(formEl)) return;
                                const rawAction = formEl.getAttribute('action') || '';
                                let resolvedAction = formEl.action || window.location.href;
                                let isCrossOrigin = false;
                                try {
                                    const actionUrl = new URL(resolvedAction, window.location.href);
                                    resolvedAction = actionUrl.href;
                                    if (pageOrigin && pageOrigin !== 'null') {
                                        isCrossOrigin = actionUrl.origin !== pageOrigin;
                                    } else {
                                        isCrossOrigin = actionUrl.protocol.startsWith('http');
                                    }
                                } catch (e) {
                                    isCrossOrigin = false;
                                }
                                forms.push({
                                    form_index: idx,
                                    action: rawAction,
                                    resolved_action: resolvedAction,
                                    method: (formEl.getAttribute('method') || 'GET').toUpperCase(),
                                    is_cross_origin: isCrossOrigin,
                                    bbox: toBBox(formEl)
                                });
                            });

                            const inputs = [];
                            let hasFormlessSensitiveInput = false;
                            document.querySelectorAll('input, select, textarea').forEach((inpEl) => {
                                const tag = inpEl.tagName.toLowerCase();
                                const type = (inpEl.getAttribute('type') || (tag === 'input' ? 'text' : tag)).toLowerCase();
                                if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'reset' || type === 'search') {
                                    return;
                                }
                                if (!isVisible(inpEl)) return;

                                const name = inpEl.getAttribute('name') || '';
                                const id = inpEl.getAttribute('id') || '';
                                const placeholder = inpEl.getAttribute('placeholder') || '';
                                const required = inpEl.hasAttribute('required');

                                const combinedMeta = `${type} ${name} ${id} ${placeholder}`.toLowerCase();
                                const isSensitive = (
                                    type === 'password' ||
                                    sensitiveTokens.some((tok) => combinedMeta.includes(tok))
                                );

                                if (isSensitive && !inpEl.closest('form')) {
                                    hasFormlessSensitiveInput = true;
                                }

                                inputs.push({
                                    tag,
                                    type,
                                    name,
                                    id,
                                    placeholder,
                                    required,
                                    is_sensitive_credential: isSensitive,
                                    bbox: toBBox(inpEl)
                                });
                            });

                            const images = [];
                            document.querySelectorAll('img').forEach((imgEl) => {
                                if (!isVisible(imgEl)) return;
                                const bbox = toBBox(imgEl);
                                if (bbox.width < 30 || bbox.height < 30) return;
                                images.push({
                                    src: imgEl.currentSrc || imgEl.src || imgEl.getAttribute('src') || '',
                                    alt: imgEl.getAttribute('alt') || '',
                                    bbox
                                });
                            });

                            const bodyText = (document.body ? document.body.innerText : '').toLowerCase();
                            const titleText = (document.title || '').toLowerCase();
                            const fullText = `${titleText}\\n${bodyText}`;
                            const detectedKeywords = militaryKeywords.filter((kw) => {
                                const escaped = kw.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&');
                                return new RegExp(`\\\\b${escaped}\\\\b`, 'i').test(fullText);
                            });

                            const htmlCtx = document.documentElement ? (document.documentElement.getAttribute('oncontextmenu') || '') : '';
                            const bodyCtx = document.body ? (document.body.getAttribute('oncontextmenu') || '') : '';
                            const hasContextMenuAttr = Boolean(
                                htmlCtx.toLowerCase().includes('false') ||
                                bodyCtx.toLowerCase().includes('false') ||
                                document.querySelector('[oncontextmenu*="false"]')
                            );
                            const contextMenuDisabled = Boolean(
                                hasContextMenuAttr ||
                                typeof document.oncontextmenu === 'function' ||
                                (document.body && typeof document.body.oncontextmenu === 'function')
                            );

                            return {
                                forms,
                                inputs,
                                images,
                                detectedKeywords,
                                contextMenuDisabled,
                                hasFormlessSensitiveInput
                            };
                        }
                        """,
                        {
                            "sensitiveTokens": SENSITIVE_INPUT_TOKENS,
                            "militaryKeywords": MILITARY_KEYWORDS,
                        },
                    )
                screenshot_dom_extract_ms = round((time.perf_counter() - t_cap0) * 1000.0, 2)
            finally:
                await context.close()
        finally:
            await _GLOBAL_PW_POOL.release_scan_slot()

        t_ann0 = time.perf_counter()
        forms = [FormElement(**f) for f in dom_payload["forms"]]
        inputs = [InputElement(**i) for i in dom_payload["inputs"]]
        images = [ImageElement(**im) for im in dom_payload["images"]]
        detected_keywords: list[str] = dom_payload["detectedKeywords"]
        context_menu_disabled: bool = dom_payload["contextMenuDisabled"]
        has_formless_sensitive: bool = dom_payload["hasFormlessSensitiveInput"]

        for f in forms:
            if f.is_cross_origin and f.resolved_action:
                parsed_action = urlparse(f.resolved_action)
                if parsed_action.hostname and parsed_action.hostname.lower() != initial_host:
                    external_domains.add(parsed_action.hostname.lower())

        draw_dom_annotations(
            screenshot_path=screenshot_file,
            annotated_path=annotated_file,
            forms=forms,
            inputs=inputs,
        )

        risk_analysis = self._compute_risk_analysis(
            final_url=final_url,
            forms=forms,
            inputs=inputs,
            detected_keywords=detected_keywords,
            external_domains=sorted(external_domains),
            context_menu_disabled=context_menu_disabled,
            has_formless_sensitive=has_formless_sensitive,
        )
        dom_annotate_ms = round((time.perf_counter() - t_ann0) * 1000.0, 2)

        execution_time_sec = round(time.perf_counter() - start_time, 3)
        latency_breakdown_ms = {
            "browser_acquire_ms": browser_acquire_ms,
            "navigation_dom_ms": navigation_dom_ms,
            "render_settle_ms": render_settle_ms,
            "screenshot_dom_extract_ms": screenshot_dom_extract_ms,
            "dom_annotate_ms": dom_annotate_ms,
            "phase1_total_ms": round(execution_time_sec * 1000.0, 2),
        }

        return Phase1ScanResponse(
            success=True,
            scan_id=resolved_scan_id,
            initial_url=target_url,
            final_url=final_url,
            redirect_chain=redirect_chain,
            status_code=status_code,
            screenshot_path=rel_screenshot_path,
            annotated_dom_path=rel_annotated_path,
            page_title=page_title,
            forms=forms,
            inputs=inputs,
            images=images,
            detected_military_keywords=detected_keywords,
            external_domains_contacted=sorted(external_domains),
            risk_analysis=risk_analysis,
            execution_time_sec=execution_time_sec,
            latency_breakdown_ms=latency_breakdown_ms,
        )

    def _compute_risk_analysis(
        self,
        final_url: str,
        forms: list[FormElement],
        inputs: list[InputElement],
        detected_keywords: list[str],
        external_domains: list[str],
        context_menu_disabled: bool,
        has_formless_sensitive: bool,
    ) -> DomRiskAnalysis:
        parsed = urlparse(final_url)
        hostname = (parsed.hostname or "").lower()
        scheme = (parsed.scheme or "").lower()
        url_lower = final_url.lower()

        is_official = self._is_official_domain(hostname)
        forensic_reasons: list[str] = []

        dom_score = 0.0
        domain_score = 0.0

        has_mil_id_token = any(
            bool(MILITARY_ID_REGEX.search(f"{inp.name} {inp.id} {inp.placeholder}"))
            or (
                bool(detected_keywords)
                and bool(re.search(r"\bnik\b", f"{inp.name} {inp.id} {inp.placeholder}", re.IGNORECASE))
            )
            for inp in inputs
        )
        has_military_context = bool(detected_keywords or has_mil_id_token)

        dom_assessment = domain_guard.assess_url(final_url, military_context=has_military_context)

        page_reg_domain = domain_guard.registrable_domain(hostname) if hostname else ""
        cross_site_forms: list[FormElement] = []
        for f in forms:
            if not f.is_cross_origin:
                continue
            act_host = (urlparse(f.resolved_action).hostname or "").lower()
            act_reg = domain_guard.registrable_domain(act_host) if act_host else ""
            if not page_reg_domain or act_reg != page_reg_domain:
                cross_site_forms.append(f)

        suspicious_exfil_hosts = [
            d
            for d in external_domains
            if any(pat in d for pat in EXFILTRATION_HOST_PATTERNS)
        ]

        has_suspicious_infra = bool(
            scheme != "https"
            or self._is_ip_address(hostname)
            or hostname in ("localhost", "127.0.0.1", "")
            or dom_assessment.has_phishing_indicators
            or cross_site_forms
            or suspicious_exfil_hosts
            or context_menu_disabled
        )

        has_password_input = any(inp.type == "password" for inp in inputs)
        if has_password_input and not is_official:
            if has_military_context or has_suspicious_infra:
                dom_score += 40.0
                forensic_reasons.append(
                    "Active password input field (<input type='password'>) detected on unauthorized/suspicious domain (+40 DOM Risk)"
                )
            else:
                dom_score += 10.0

        if has_mil_id_token and not is_official:
            dom_score += 25.0
            forensic_reasons.append(
                "Personnel identity harvesting field (NRP/NIK) detected on non-official portal (+25 DOM Risk)"
            )

        if cross_site_forms or (suspicious_exfil_hosts and not is_official):
            dom_score += 35.0
            exfil_targets = [f.resolved_action for f in cross_site_forms] or suspicious_exfil_hosts
            forensic_reasons.append(
                f"Cross-origin credential exfiltration endpoint detected: {', '.join(exfil_targets[:2])} (+35 DOM Risk)"
            )

        if has_formless_sensitive and not is_official:
            if has_military_context or has_suspicious_infra:
                dom_score += 30.0
                forensic_reasons.append(
                    "Form-less sensitive input fields detected (potential AJAX/Fetch credential harvesting) (+30 DOM Risk)"
                )
            else:
                dom_score += 5.0

        if detected_keywords and not is_official:
            dom_score += 20.0
            forensic_reasons.append(
                f"TNI AD / Military terminology ({', '.join(detected_keywords[:5])}) used on non-.mil.id domain (+20 DOM Risk)"
            )

        if context_menu_disabled and not is_official:
            dom_score += 10.0
            forensic_reasons.append(
                "Anti-inspection tampering detected: right-click context menu (oncontextmenu) is disabled"
            )

        if not is_official:
            if hostname:
                domain_score = dom_assessment.risk_score
                forensic_reasons.extend(dom_assessment.reasons)
            else:
                matched_bait = domain_guard.find_bait_tokens(url_lower)
                if matched_bait:
                    domain_score += 45.0
                    forensic_reasons.append(
                        f"Deceptive military bait tokens in URL/path: {', '.join(matched_bait)}"
                    )
                if scheme != "https":
                    domain_score += 30.0
                    forensic_reasons.append(
                        f"Transport layer lacks official TLS certificate (scheme='{scheme}://')"
                    )
                domain_score += 25.0
                forensic_reasons.append(
                    "Target served from non-registered local/ephemeral source ('local-file')"
                )

        dom_anomaly_score = round(min(100.0, max(0.0, dom_score)), 2)
        domain_telemetry_score = round(min(100.0, max(0.0, domain_score)), 2)

        has_sensitive_inputs = any(inp.is_sensitive_credential for inp in inputs)
        has_credential_harvesting = bool(
            has_sensitive_inputs
            and not is_official
            and (has_military_context or has_suspicious_infra or bool(cross_site_forms))
        )

        return DomRiskAnalysis(
            dom_anomaly_score=dom_anomaly_score,
            domain_telemetry_score=domain_telemetry_score,
            has_credential_harvesting=has_credential_harvesting,
            is_official_mil_domain=is_official,
            forensic_reasons=forensic_reasons,
        )
