"""Security regression tests: SSRF / local-file reads / webhook spoofing / CORS / PII masking."""
import asyncio
import hashlib
import hmac
import json
import os

import httpx
import pytest

from app import security
from app.main import app


def _client(remote: bool = False):
    client_addr = ("203.0.113.7", 40000) if remote else ("127.0.0.1", 40000)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app, client=client_addr),
                             base_url="http://testserver", timeout=60)


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture(autouse=True)
def _env():
    os.environ["OPENWA_WEBHOOK_SECRET"] = ""
    os.environ["OPENWA_WEBHOOK_TOKEN"] = ""
    os.environ["ALLOW_PRIVATE_SCAN_TARGETS"] = "false"
    yield


@pytest.mark.parametrize("url", [
    "file:///etc/passwd",
    "http://localhost:2785/api/sessions",
    "http://169.254.169.254/latest/meta-data/",
    "http://127.0.0.1:8000/docs",
])
def test_rest_scan_url_blocks_ssrf(url):
    async def go():
        async with _client() as c:
            return await c.post("/api/v1/scan-url", json={"url": url})
    r = _run(go())
    assert r.status_code == 400 and "ditolak" in r.json()["detail"]


@pytest.mark.parametrize("path", [
    "/etc/passwd", "file:///etc/hostname", "../../../../etc/hostname", ".env", "C:/Windows/win.ini",
])
def test_scan_image_blocks_arbitrary_local_files(path):
    async def go():
        async with _client() as c:
            return await c.post("/api/v1/scan-image", json={"image_url": path})
    r = _run(go())
    assert r.status_code == 400


def test_scan_image_allows_project_assets():
    p = security.resolve_local_image_path("mock_targets/assets/poster_quishing_bintara.png")
    assert p.exists()


def test_openwa_webhook_rejects_remote_without_secret():
    body = {"event": "message.received", "sessionId": "s", "data": {"id": "R1", "chatId": "62811@c.us", "body": "halo"}}
    async def go():
        async with _client(remote=True) as c:
            return await c.post("/webhook/openwa?sync=true&dry_run=true", json=body)
    assert _run(go()).status_code == 401


def test_openwa_webhook_tunnel_from_localhost_is_not_trusted():
    body = {"event": "message.received", "sessionId": "s", "data": {"id": "R2", "chatId": "62811@c.us", "body": "halo"}}
    async def go():
        async with _client() as c:
            return await c.post("/webhook/openwa?sync=true&dry_run=true", json=body,
                                headers={"X-Forwarded-For": "198.51.100.9"})
    assert _run(go()).status_code == 401


def test_openwa_webhook_remote_with_valid_signature_ok():
    os.environ["OPENWA_WEBHOOK_SECRET"] = "abc123"
    raw = json.dumps({"event": "message.received", "sessionId": "s",
                      "data": {"id": "R3", "chatId": "62811@c.us", "body": "halo"}}).encode()
    sig = "sha256=" + hmac.new(b"abc123", raw, hashlib.sha256).hexdigest()
    async def go():
        async with _client(remote=True) as c:
            return await c.post("/webhook/openwa?sync=true&dry_run=true", content=raw,
                                headers={"content-type": "application/json", "X-OpenWA-Signature": sig})
    r = _run(go())
    assert r.status_code == 200 and r.json()["triage"] == "HELP"


def test_openwa_webhook_remote_with_token_ok():
    os.environ["OPENWA_WEBHOOK_TOKEN"] = "tok-xyz"
    body = {"event": "message.received", "sessionId": "s", "data": {"id": "R4", "chatId": "62811@c.us", "body": "halo"}}
    async def go():
        async with _client(remote=True) as c:
            bad = await c.post("/webhook/openwa?sync=true&dry_run=true&token=wrong", json=body)
            good = await c.post("/webhook/openwa?sync=true&dry_run=true&token=tok-xyz", json=body)
            return bad, good
    bad, good = _run(go())
    assert bad.status_code == 401 and good.status_code == 200


def test_fonnte_webhook_rejects_remote():
    async def go():
        async with _client(remote=True) as c:
            return await c.post("/webhook/wa", json={"sender": "62811", "message": "help"})
    assert _run(go()).status_code == 401


def test_seed_portals_admin_only_remote():
    async def go():
        async with _client(remote=True) as c:
            return await c.post("/api/v1/supabase/seed-portals")
    assert _run(go()).status_code == 403


def test_cors_not_wildcard_with_credentials():
    async def go():
        async with _client() as c:
            return await c.options("/health", headers={"Origin": "https://evil.example",
                                                       "Access-Control-Request-Method": "GET"})
    r = _run(go())
    assert r.headers.get("access-control-allow-origin") != "https://evil.example"
    assert r.headers.get("access-control-allow-credentials") != "true"


def test_mask_phone():
    assert security.mask_phone("6281234567890@c.us") == "62812****890@c.us"
    assert "34567" not in security.mask_phone("6281234567890")
