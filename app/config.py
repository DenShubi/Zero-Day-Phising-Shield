import os
from pathlib import Path
from typing import Optional

BASE_DIR = Path(__file__).resolve().parent.parent
ENV_FILE = BASE_DIR / ".env"

_DOTENV_CACHE: dict[str, tuple[tuple[int, int], dict[str, str]]] = {}


def load_dotenv_file(env_path: Optional[Path] = None) -> dict[str, str]:
    """
    Lightweight zero-dependency `.env` parser cached by file `(mtime_ns, size)` so
    credential updates take effect immediately without disk I/O overhead per scan.
    """
    target = env_path or ENV_FILE
    if not target.exists():
        return {}

    stat = target.stat()
    sig = (stat.st_mtime_ns, stat.st_size)
    cache_key = str(target.resolve())
    cached = _DOTENV_CACHE.get(cache_key)
    if cached is not None and cached[0] == sig:
        return cached[1]

    parsed: dict[str, str] = {}
    for raw_line in target.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        parsed[key] = val

    _DOTENV_CACHE[cache_key] = (sig, parsed)
    return parsed


def get_env(key: str, default: str = "", aliases: tuple[str, ...] = ()) -> str:
    """
    Resolve an environment variable from OS environment first (if explicitly set in
    `os.environ`, including empty string overrides), then `.env` file.
    """
    file_vars = load_dotenv_file()
    for candidate in (key, *aliases):
        if candidate in os.environ:
            os_val = os.environ[candidate].strip()
            if os_val:
                return os_val
            # Explicit empty string in os.environ intentionally overrides .env
            continue
        file_val = file_vars.get(candidate, "").strip()
        if file_val:
            return file_val
    return default
