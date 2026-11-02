"""Shared fixtures: isolate tests from real Supabase/OpenWA credentials and serve mock targets."""
import functools
import http.server
import os
import socketserver
import sys
import tempfile
import threading
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# Never talk to the real Supabase project or the real WhatsApp gateway from tests.
for _k in ("SUPABASE_URL", "SUPABASE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_URL"):
    os.environ[_k] = "http://supabase.invalid" if _k.endswith("URL") else "test-disabled"
os.environ["OPENWA_WEBHOOK_SECRET"] = ""

# `get_env` falls back to the real `.env` when an OS value is empty, so a developer's
# real secrets would leak into the tests (e.g. webhook HMAC => 401). Point the loader
# at a non-existent file: tests must never read the real `.env`.
import app.config as _cfg  # noqa: E402

_cfg.ENV_FILE = ROOT / "tests" / ".no-such-env"


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):  # noqa: D401
        pass


@pytest.fixture(scope="session")
def mock_site():
    """Serve mock_targets/ under /mock-targets/ on 127.0.0.1 (same path as the FastAPI mount)."""
    tmp = Path(tempfile.mkdtemp())
    (tmp / "mock-targets").symlink_to(ROOT / "mock_targets", target_is_directory=True)
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), functools.partial(_Quiet, directory=str(tmp)))
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}/mock-targets"
    srv.shutdown()
