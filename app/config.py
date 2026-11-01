import os
from pathlib import Path
from typing import Optional

BASE_DIR = Path(__file__).resolve().parent.parent
ENV_FILE = BASE_DIR / ".env"


def load_dotenv_file(env_path: Optional[Path] = None) -> dict[str, str]:
    """
    Lightweight zero-dependency `.env` parser that reads `backend-engine/.env`
    fresh on demand so credential updates take effect immediately without
    requiring extra pip packages or server restarts.
    """
    target = env_path or ENV_FILE
    parsed: dict[str, str] = {}
    if not target.exists():
        return parsed

    for raw_line in target.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        parsed[key] = val
    return parsed


def get_env(key: str, default: str = "", aliases: tuple[str, ...] = ()) -> str:
    """
    Resolve an environment variable from OS environment first, then `.env` file,
    checking optional alias keys (e.g. SUPABASE_SERVICE_ROLE_KEY / SUPABASE_KEY).
    """
    file_vars = load_dotenv_file()
    for candidate in (key, *aliases):
        os_val = os.environ.get(candidate, "").strip()
        if os_val:
            return os_val
        file_val = file_vars.get(candidate, "").strip()
        if file_val:
            return file_val
    return default

