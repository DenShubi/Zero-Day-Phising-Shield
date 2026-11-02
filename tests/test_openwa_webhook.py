"""
End-to-end tests of /webhook/openwa against a FAKE OpenWA gateway (no real WhatsApp).
Covers: text/URL/image triage, inline + omitted (downloaded) media, evidence image
reply via base64, event filtering, dedupe, groups, HMAC signature, SSRF refusal.
"""
import asyncio
import base64
import hashlib
import hmac
import json
import os
import socket
import threading
import time
from pathlib import Path

import cv2
import httpx
import numpy as np
import pytest
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import Response

from app.main import app

ROOT = Path(__file__).resolve().parent.parent
POSTER = ROOT / "mock_targets" / "assets" / "poster_quishing_bintara.png"
SESSION = "test-session-0001"
CHAT = "6281234567890@c.us"

# ----------------------------------------------------------------- fake gateway
fake = FastAPI()
CALLS: list[dict] = []
MEDIA_STORE: dict[str, bytes] = {}


@fake.post("/api/sessions/{sid}/messages/send-text")
async def _send_text(sid: str, request: Request):
    CALLS.append({"route": "send-text", "sid": sid, "key": request.headers.get("x-api-key"), **(await request.json())})
    return {"messageId": f"true_{CHAT}_TXT{len(CALLS)}", "timestamp": int(time.time())}


@fake.post("/api/sessions/{sid}/messages/send-image")
async def _send_image(sid: str, request: Request):
    CALLS.append({"route": "send-image", "sid": sid, "key": request.headers.get("x-api-key"), **(await request.json())})
    return Response(status_code=201, content=json.dumps({"messageId": "IMG"}), media_type="application/json")


@fake.get("/api/sessions/{sid}/messages/{chat_id}/{message_id}/media")
async def _media(sid: str, chat_id: str, message_id: str):
    data = MEDIA_STORE.get(message_id)
    if data is None:
        return Response(status_code=404)
    return Response(content=data, media_type="image/png")


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module", autouse=True)
def fake_openwa():
    port = _free_port()
    server = uvicorn.Server(uvicorn.Config(fake, host="127.0.0.1", port=port, log_level="warning"))
    t = threading.Thread(target=server.run, daemon=True)
    t.start()
    for _ in range(100):
        if server.started:
            break
        time.sleep(0.05)
    os.environ.update(
        OPENWA_API_URL=f"http://127.0.0.1:{port}",
        OPENWA_API_KEY="owa_test_key",
        OPENWA_SESSION_ID=SESSION,
        OPENWA_ALLOW_GROUPS="false",
        OPENWA_SEND_EVIDENCE="true",
    )
    yield
    server.should_exit = True
    t.join(timeout=5)


@pytest.fixture(autouse=True)
def _reset():
    CALLS.clear()
    MEDIA_STORE.clear()
    from app import webhook_openwa

    webhook_openwa._seen_keys.clear()
    os.environ["OPENWA_WEBHOOK_SECRET"] = ""


def _event(data: dict, event="message.received", msg_id=None) -> dict:
    msg_id = msg_id or f"3EB0{time.time_ns()}"
    return {
        "event": event,
        "timestamp": "2026-11-02T10:00:00.000Z",
        "sessionId": SESSION,
        "idempotencyKey": f"msg_{SESSION}_{msg_id}_wh1",
        "deliveryId": "dlv_test",
        "data": {"id": msg_id, "from": CHAT, "to": "62800@c.us", "chatId": CHAT, "fromMe": False,
                 "isGroup": False, "kind": "individual", "type": "chat", "timestamp": 1793600000,
                 "contact": {"pushName": "Serda Uji"}, **data},
    }


def _post(body: dict, params: str = "?sync=true", headers: dict | None = None, raw: bytes | None = None):
    async def _go():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=120) as c:
            if raw is not None:
                return await c.post(f"/webhook/openwa{params}", content=raw,
                                    headers={"content-type": "application/json", **(headers or {})})
            return await c.post(f"/webhook/openwa{params}", json=body, headers=headers or {})
    return asyncio.run(_go())


def _routes():
    return [c["route"] for c in CALLS]


# ----------------------------------------------------------------- tests
def test_status_endpoint():
    async def _go():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
            return (await c.get("/webhook/openwa")).json()
    info = asyncio.run(_go())
    assert info["api_key_configured"] is True and "message.received" in info["accepted_events"]


def test_help_text_reply():
    r = _post(_event({"body": "halo"}))
    assert r.status_code == 200 and r.json()["triage"] == "HELP"
    assert _routes() == ["send-text"]
    assert CALLS[0]["chatId"] == CHAT and CALLS[0]["key"] == "owa_test_key" and CALLS[0]["sid"] == SESSION


def test_portal_command():
    r = _post(_event({"body": "/portal"}))
    assert r.json()["triage"] == "COMMAND" and "tniad.mil.id" in CALLS[0]["text"]


def test_inline_image_scan_sends_report_and_evidence_image():
    b64 = base64.b64encode(POSTER.read_bytes()).decode()
    t0 = time.perf_counter()
    r = _post(_event({"type": "image", "body": "", "media": {"mimetype": "image/png", "data": b64}}))
    elapsed = time.perf_counter() - t0
    body = r.json()
    assert body["triage"] == "IMAGE"
    assert body["scan"]["verdict"] == "CRITICAL_PHISHING"
    assert body["scan"]["decoded_qr_count"] == 1
    assert _routes() == ["send-text", "send-text", "send-image"]  # ack, report, evidence
    img_call = CALLS[2]
    assert img_call["mimetype"] == "image/png" and len(img_call["caption"]) <= 1024
    decoded = cv2.imdecode(np.frombuffer(base64.b64decode(img_call["base64"]), np.uint8), cv2.IMREAD_COLOR)
    assert decoded is not None and decoded.shape[1] == 1280
    assert "rekrutmen-bintara-tniad.com" in CALLS[1]["text"]
    assert elapsed < 10, f"image triage too slow: {elapsed:.1f}s"


def test_omitted_media_is_downloaded_from_gateway():
    MEDIA_STORE["BIGIMG1"] = POSTER.read_bytes()
    r = _post(_event({"type": "image", "media": {"mimetype": "image/jpeg", "omitted": True, "sizeBytes": 2_000_000}},
                     msg_id="BIGIMG1"))
    assert r.json()["triage"] == "IMAGE" and r.json()["scan"]["verdict"] == "CRITICAL_PHISHING"


def test_non_image_media_gets_friendly_error():
    r = _post(_event({"type": "ptt", "media": {"mimetype": "audio/ogg", "data": "AAAA"}}))
    assert r.json()["triage"] == "ERROR" and "LAMPIRAN" in CALLS[0]["text"]


def test_url_scan_of_mock_target(mock_site):
    r = _post(_event({"body": f"Izin, ada link ini {mock_site}/rekrutmen_bintara_phish.html"}))
    body = r.json()
    assert body["triage"] == "URL" and body["scan"]["verdict"] == "CRITICAL_PHISHING"
    assert _routes() == ["send-text", "send-text", "send-image"]


def test_ssrf_url_refused_without_scanning():
    r = _post(_event({"body": "http://localhost:2785/api/sessions"}))
    assert r.json()["triage"] == "REFUSED" and _routes() == ["send-text"]
    assert "DITOLAK" in CALLS[0]["text"]


@pytest.mark.parametrize(
    "patch,reason",
    [
        ({"fromMe": True}, "outgoing_message"),
        ({"isGroup": True, "chatId": "1203630@g.us", "kind": "group"}, "group_chat_disabled"),
        ({"chatId": "status@broadcast", "kind": "status"}, "status_or_broadcast"),
    ],
)
def test_skipped_messages(patch, reason):
    r = _post(_event({"body": "halo", **patch}))
    assert r.json()["skipped"] == reason and CALLS == []


def test_non_message_events_ignored():
    r = _post(_event({"status": "read"}, event="message.ack"))
    assert r.json()["skipped"] == "event:message.ack" and CALLS == []


def test_duplicate_delivery_processed_once():
    ev = _event({"body": "halo"}, msg_id="DUP1")
    _post(ev, headers={"X-OpenWA-Idempotency-Key": "msg_x_DUP1_wh1"})
    r2 = _post(ev, headers={"X-OpenWA-Idempotency-Key": "msg_x_DUP1_wh1"})
    assert r2.json()["skipped"] == "duplicate_delivery" and len(CALLS) == 1


def test_background_mode_acknowledges_then_replies():
    r = _post(_event({"body": "status"}), params="")
    assert r.json()["queued"] is True and r.json()["triage_hint"] == "COMMAND"
    # Starlette runs BackgroundTasks before the ASGI call returns under ASGITransport
    assert _routes() == ["send-text"]


def test_hmac_signature_enforced_when_secret_set():
    os.environ["OPENWA_WEBHOOK_SECRET"] = "s3cret"
    raw = json.dumps(_event({"body": "halo"})).encode()
    assert _post({}, raw=raw, headers={"X-OpenWA-Signature": "sha256=bad"}).status_code == 401
    good = "sha256=" + hmac.new(b"s3cret", raw, hashlib.sha256).hexdigest()
    assert _post({}, raw=raw, headers={"X-OpenWA-Signature": good}).status_code == 200


def test_dry_run_sends_nothing():
    r = _post(_event({"body": "darurat"}), params="?sync=true&dry_run=true")
    assert r.json()["triage"] == "COMMAND" and CALLS == []
