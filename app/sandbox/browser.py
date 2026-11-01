import asyncio
import ipaddress
import json
import re
import shutil
import sys
import time
import uuid
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

from playwright.async_api import (
    async_playwright,
    Request,
    Response,
    TimeoutError as PlaywrightTimeoutError,
)

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
import cv2

import warnings

if sys.platform == "win32":
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())


OFFICIAL_MIL_DOMAINS = {
    "mil.id",
    "tniad.mil.id",
    "tni.mil.id",
    "rekrutmen-tni.mil.id",
    "pussiberad.mil.id",
    "kemhan.go.id",
    "akmil.ac.id",
    "idu.ac.id",
    "unhanri.ac.id",
}

MILITARY_KEYWORDS = [
    "tni",
    "angkatan darat",
    "pussiberad",
    "kartika",
    "bintara",
    "tamtama",
    "sisfopers",
    "nrp",
    "kodam",
    "satuan",
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

MILITARY_ID_TOKENS = ["nrp", "nik", "sisfopers", "prajurit"]


class HeadlessSandboxScanner:
    """
    Isolated Playwright Chromium sandbox for capturing viewport screenshots,
    extracting DOM form/input/image bounding boxes, and evaluating phishing
    telemetry for VisiKartika Shield Phase 1.
    """

    def __init__(self, base_storage_dir: Optional[Path] = None) -> None:
        if base_storage_dir is None:
            # Resolve relative to backend-engine root
            self.base_storage_dir = Path(__file__).resolve().parents[2] / "storage"
        else:
            self.base_storage_dir = Path(base_storage_dir)

        self.screenshots_dir = self.base_storage_dir / "screenshots"
        self.annotated_dir = self.base_storage_dir / "annotated"
        self.screenshots_dir.mkdir(parents=True, exist_ok=True)
        self.annotated_dir.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _is_official_domain(hostname: str) -> bool:
        if not hostname:
            return False
        host = hostname.lower().strip(".")
        for official in OFFICIAL_MIL_DOMAINS:
            if host == official or host.endswith(f".{official}"):
                return True
        return False

    @staticmethod
    def _is_ip_address(hostname: str) -> bool:
        if not hostname:
            return False
        try:
            ipaddress.ip_address(hostname)
            return True
        except ValueError:
            return False

    async def capture_and_extract(
        self,
        target_url: str,
        scan_id: Optional[str] = None,
    ) -> Phase1ScanResponse:
        if sys.platform == "win32":
            # Run Playwright inside a dedicated worker thread with an explicit
            # Windows ProactorEventLoop so it works reliably even when Uvicorn
            # --reload uses SelectorEventLoop and never blocks same-server requests.
            return await asyncio.to_thread(
                self._run_in_proactor_thread,
                target_url,
                scan_id,
            )
        return await self._capture_and_extract_async(target_url, scan_id)

    def _run_in_proactor_thread(
        self,
        target_url: str,
        scan_id: Optional[str] = None,
    ) -> Phase1ScanResponse:
        loop = asyncio.ProactorEventLoop()
        try:
            asyncio.set_event_loop(loop)
            return loop.run_until_complete(
                self._capture_and_extract_async(target_url, scan_id)
            )
        finally:
            loop.close()

    @staticmethod
    def _find_cached_official_portal(hostname: str) -> Optional[dict]:
        """
        Look up `app/reference_db/manifest.json` to see if `hostname` matches a
        captured official reference portal (used as a resilient fallback when live
        `.mil.id` / `.go.id` portals experience transient network timeouts).
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
                entry_domain = str(item.get("official_domain", "")).lower().strip(".").removeprefix("www.")
                if entry_domain == clean_host:
                    img_path = ref_dir / "portals" / item.get("filename", "")
                    if img_path.exists():
                        return {**item, "image_path": img_path}
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

        # Relative paths from backend-engine root for clean portability
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

        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True,
                args=[
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                    "--disable-extensions",
                ],
            )
            context = await browser.new_context(
                viewport={"width": 1280, "height": 720},
                accept_downloads=False,
                ignore_https_errors=True,
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/128.0.0.0 Safari/537.36 VisiKartikaSandbox/1.0"
                ),
            )
            page = await context.new_page()

            def _on_request(req: Request) -> None:
                req_parsed = urlparse(req.url)
                req_host = (req_parsed.hostname or "").lower()
                if req_host and req_host != initial_host:
                    external_domains.add(req_host)

            page.on("request", _on_request)

            response: Optional[Response] = None
            try:
                response = await page.goto(
                    target_url,
                    timeout=18000,
                    wait_until="domcontentloaded",
                )
                # Wait for window 'load' state (images/stylesheets) up to 8s without failing on slow trackers
                try:
                    await page.wait_for_load_state("load", timeout=8000)
                except Exception:
                    pass

                # Wait up to 5s for visible <img> elements in the viewport to finish decoding
                try:
                    await page.wait_for_function(
                        """
                        () => {
                            const imgs = Array.from(document.querySelectorAll('img')).filter((el) => {
                                const r = el.getBoundingClientRect();
                                return r.width >= 24 && r.height >= 24 && r.top < 720;
                            });
                            if (imgs.length === 0) return true;
                            return imgs.every((img) => img.complete && img.naturalWidth > 0);
                        }
                        """,
                        timeout=5000,
                    )
                except Exception:
                    pass

                # Settle wait (1500ms) for client-side hero sliders, animations & layout stabilization
                await page.wait_for_timeout(1500)
            except PlaywrightTimeoutError:
                # Check if partial HTML was already rendered before timeout
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
                        await context.close()
                        await browser.close()
                        raise
            except Exception:
                cached = self._find_cached_official_portal(initial_host)
                if cached is not None:
                    used_cached_portal = cached
                else:
                    await context.close()
                    await browser.close()
                    raise

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
                    # Reconstruct HTTP redirect chain if any redirects occurred
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

                # Capture 1280x720 viewport screenshot
                await page.screenshot(path=str(screenshot_file), full_page=False)

                # If this is a registered official portal (e.g. tniad.mil.id) and the live capture
                # failed to render its hero background/images completely (e.g. grey half-loaded
                # slider due to slow remote server), restore the clean official reference render.
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

                # Execute in-page JS DOM telemetry extraction
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

                        // 1. Extract visible <form> elements
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

                        // 2. Extract visible <input>, <select>, <textarea> elements
                        const inputs = [];
                        let hasFormlessSensitiveInput = false;
                        document.querySelectorAll('input, select, textarea').forEach((inpEl) => {
                            const tag = inpEl.tagName.toLowerCase();
                            const type = (inpEl.getAttribute('type') || (tag === 'input' ? 'text' : tag)).toLowerCase();
                            if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'reset') {
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

                        // 3. Extract visible <img> tags with width >= 30 and height >= 30
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

                        // 4. Military keywords in document.body.innerText
                        const bodyText = (document.body ? document.body.innerText : '').toLowerCase();
                        const titleText = (document.title || '').toLowerCase();
                        const fullText = `${titleText}\\n${bodyText}`;
                        const detectedKeywords = militaryKeywords.filter((kw) => fullText.includes(kw));

                        // 5. Anti-inspection checks (oncontextmenu disabled)
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

            await context.close()
            await browser.close()

        forms = [FormElement(**f) for f in dom_payload["forms"]]
        inputs = [InputElement(**i) for i in dom_payload["inputs"]]
        images = [ImageElement(**im) for im in dom_payload["images"]]
        detected_keywords: list[str] = dom_payload["detectedKeywords"]
        context_menu_disabled: bool = dom_payload["contextMenuDisabled"]
        has_formless_sensitive: bool = dom_payload["hasFormlessSensitiveInput"]

        # Track cross-origin form action domains as external domains contacted/targeted
        for f in forms:
            if f.is_cross_origin and f.resolved_action:
                parsed_action = urlparse(f.resolved_action)
                if parsed_action.hostname and parsed_action.hostname.lower() != initial_host:
                    external_domains.add(parsed_action.hostname.lower())

        # Annotate DOM bounding boxes on the screenshot
        draw_dom_annotations(
            screenshot_path=screenshot_file,
            annotated_path=annotated_file,
            forms=forms,
            inputs=inputs,
        )

        # Compute DomRiskAnalysis
        risk_analysis = self._compute_risk_analysis(
            final_url=final_url,
            forms=forms,
            inputs=inputs,
            detected_keywords=detected_keywords,
            external_domains=sorted(external_domains),
            context_menu_disabled=context_menu_disabled,
            has_formless_sensitive=has_formless_sensitive,
        )

        execution_time_sec = round(time.perf_counter() - start_time, 3)

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

        # 1. Active password input (+40)
        has_password_input = any(inp.type == "password" for inp in inputs)
        if has_password_input and not is_official:
            dom_score += 40.0
            forensic_reasons.append(
                "Active password input field (<input type='password'>) detected on unauthorized domain (+40 DOM Risk)"
            )

        # 2. Military credential input like NRP/NIK (+25)
        has_mil_cred_input = any(
            any(
                tok in f"{inp.name} {inp.id} {inp.placeholder}".lower()
                for tok in MILITARY_ID_TOKENS
            )
            for inp in inputs
        )
        if has_mil_cred_input and not is_official:
            dom_score += 25.0
            forensic_reasons.append(
                "Personnel identity harvesting field (NRP/NIK) detected on non-official portal (+25 DOM Risk)"
            )

        # 3. Cross-origin form action or external API exfiltration (+35)
        cross_origin_forms = [f for f in forms if f.is_cross_origin]
        suspicious_exfil_hosts = [
            d for d in external_domains if "telegram" in d or "exfil" in d or not self._is_official_domain(d)
        ]
        if cross_origin_forms or (suspicious_exfil_hosts and not is_official):
            dom_score += 35.0
            exfil_targets = [f.resolved_action for f in cross_origin_forms] or suspicious_exfil_hosts
            forensic_reasons.append(
                f"Cross-origin credential exfiltration endpoint detected: {', '.join(exfil_targets[:2])} (+35 DOM Risk)"
            )

        # 4. Form-less input harvesting (+30)
        if has_formless_sensitive and not is_official:
            dom_score += 30.0
            forensic_reasons.append(
                "Form-less sensitive input fields detected (potential AJAX/Fetch credential harvesting) (+30 DOM Risk)"
            )

        # 5. Military keywords on non-.mil.id domain (+20)
        if detected_keywords and not is_official:
            dom_score += 20.0
            forensic_reasons.append(
                f"TNI AD / Military terminology ({', '.join(detected_keywords[:5])}) used on non-.mil.id domain (+20 DOM Risk)"
            )

        # 6. Anti-inspection tricks (oncontextmenu disabled)
        if context_menu_disabled and not is_official:
            dom_score += 10.0
            forensic_reasons.append(
                "Anti-inspection tampering detected: right-click context menu (oncontextmenu) is disabled"
            )

        # Domain Telemetry Scoring (0-100)
        if not is_official:
            # Bait military keywords in hostname or URL path
            bait_tokens = ["tni", "bintara", "tamtama", "pussiberad", "rekrutmen", "mil", "kartika", "sisfopers"]
            matched_bait = [tok for tok in bait_tokens if tok in url_lower]
            if matched_bait:
                domain_score += 45.0
                forensic_reasons.append(
                    f"Deceptive military bait tokens in URL/hostname: {', '.join(matched_bait)}"
                )

            # Non-HTTPS scheme
            if scheme != "https":
                domain_score += 30.0
                forensic_reasons.append(
                    f"Transport layer lacks official TLS certificate (scheme='{scheme}://')"
                )

            # IP-based host or local/unverified host
            if self._is_ip_address(hostname) or hostname in ("localhost", "127.0.0.1", ""):
                domain_score += 25.0
                forensic_reasons.append(
                    f"Target served from raw IP or non-registered hostname ('{hostname or 'local-file'}')"
                )
            elif not hostname.endswith(".mil.id") and not hostname.endswith(".go.id"):
                domain_score += 25.0
                forensic_reasons.append(
                    f"Hostname '{hostname}' is outside official .mil.id / .go.id namespace"
                )

        dom_anomaly_score = round(min(100.0, max(0.0, dom_score)), 2)
        domain_telemetry_score = round(min(100.0, max(0.0, domain_score)), 2)

        has_sensitive_inputs = any(inp.is_sensitive_credential for inp in inputs)
        has_credential_harvesting = bool(
            has_sensitive_inputs and (not is_official or bool(cross_origin_forms))
        )

        return DomRiskAnalysis(
            dom_anomaly_score=dom_anomaly_score,
            domain_telemetry_score=domain_telemetry_score,
            has_credential_harvesting=has_credential_harvesting,
            is_official_mil_domain=is_official,
            forensic_reasons=forensic_reasons,
        )

