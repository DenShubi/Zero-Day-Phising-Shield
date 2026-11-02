"""
VisiKartika Shield - shared security guards.

* Scan-target validation for the public REST API (SSRF / local-file protection).
* Local image path allow-list for `/api/v1/scan-image` (no arbitrary file reads).
* Webhook caller authentication (localhost, HMAC secret, or shared token).
* CORS origin configuration and PII masking for logs.
"""

from __future__ import annotations

import hmac
import re
from pathlib import Path
from typing import Optional

from fastapi import Request

from app.config import BASE_DIR, get_env

# Directories whose files may be referenced by a *local* image path.
ALLOWED_LOCAL_IMAGE_DIRS = (
    BASE_DIR / "mock_targets",
    BASE_DIR / "storage",
    BASE_DIR / "app" / "reference_db",
)

LOOPBACK_HOSTS = {"127.0.0.1", "::1", "localhost", "testclient"}


def _flag(name: str, default: bool = False) -> bool:
    return get_env(name, default="true" if default else "false").strip().lower() in ("1", "true", "yes", "on")


# --------------------------------------------------------------------------- #
# Scan targets (REST API)
# --------------------------------------------------------------------------- #
def validate_scan_target(url: str) -> tuple[bool, str]:
    """
    Same policy as WhatsApp input: http/https only; internal/private hosts are
    refused except the built-in `/mock-targets/` demo pages. Set
    `ALLOW_PRIVATE_SCAN_TARGETS=true` only on a developer machine.
    """
    from app.wa_triage import validate_chat_target_url  # local import avoids a cycle

    if _flag("ALLOW_PRIVATE_SCAN_TARGETS"):
        if url.lower().startswith(("http://", "https://")):
            return True, ""
        return False, "Hanya tautan http/https yang dapat dipindai."
    return validate_chat_target_url(url)


def resolve_local_image_path(raw_path: str) -> Path:
    """
    Resolve a local image path for `scan-image`, refusing anything outside the
    allow-listed project folders (prevents reading arbitrary files on the host).
    """
    value = raw_path.strip()
    if value.lower().startswith("file://"):
        value = re.sub(r"^file:/*", "", value, flags=re.IGNORECASE)
        if not re.match(r"^[A-Za-z]:", value):
            value = "/" + value
    candidate = Path(value)
    if not candidate.is_absolute():
        candidate = BASE_DIR / candidate
    resolved = candidate.resolve()
    for allowed in ALLOWED_LOCAL_IMAGE_DIRS:
        try:
            if resolved.is_relative_to(allowed.resolve()):
                return resolved
        except (OSError, ValueError):
            continue
    raise PermissionError(
        "Path gambar lokal hanya diizinkan dari folder mock_targets/, storage/ atau app/reference_db/."
    )


# --------------------------------------------------------------------------- #
# Webhook caller authentication
# --------------------------------------------------------------------------- #
def is_loopback_request(request: Request) -> bool:
    host = (request.client.host if request.client else "") or ""
    if host not in LOOPBACK_HOSTS:
        return False
    # A reverse proxy / tunnel (ngrok, cloudflared) also connects from 127.0.0.1;
    # it adds forwarding headers, so such requests are NOT treated as local.
    forwarded = request.headers.get("x-forwarded-for") or request.headers.get("forwarded")
    return not forwarded


def check_shared_token(request: Request, env_name: str) -> bool:
    expected = get_env(env_name)
    if not expected:
        return False
    supplied = request.query_params.get("token") or request.headers.get("x-webhook-token") or ""
    return bool(supplied) and hmac.compare_digest(supplied, expected)


# --------------------------------------------------------------------------- #
# Misc
# --------------------------------------------------------------------------- #
def cors_origins() -> list[str]:
    """Comma-separated `CORS_ORIGINS`; defaults to local dashboard dev servers."""
    raw = get_env("CORS_ORIGINS", default="http://localhost:3000,http://127.0.0.1:3000")
    return [o.strip() for o in raw.split(",") if o.strip()]


def mask_phone(value: Optional[str]) -> str:
    """6281234567890@c.us -> 62812****890@c.us (for logs)."""
    if not value:
        return "-"
    return re.sub(r"(\d{5})\d+(\d{3})", r"\1****\2", str(value))
