"""
VisiKartika Shield - Domain Whitelist & Lookalike Guard (Phase 2, Person B).

Single source of truth for:
  * the official TNI AD / TNI / Kemhan domain whitelist (`.mil.id` namespace),
  * host normalisation (case, trailing dot, port, `www.`, IDN/punycode),
  * lookalike / typosquatting heuristics against official domains.

Used by the sandbox DOM telemetry (`app/sandbox/browser.py`), the image/QR
scanner (`app/scanner_service.py`) and the WhatsApp bot (`portal` command).
"""

from __future__ import annotations

import ipaddress
import unicodedata
from dataclasses import dataclass, field
from typing import Optional
from urllib.parse import urlparse

# --------------------------------------------------------------------------- #
# Whitelist
# --------------------------------------------------------------------------- #
# Any host equal to, or a sub-domain of, one of these entries is official.
# `mil.id` itself is included because the whole `.mil.id` second-level zone is
# restricted by PANDI to Indonesian military institutions.
OFFICIAL_MIL_DOMAINS: frozenset[str] = frozenset(
    {
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
)

# Brand labels attackers typically imitate (derived from the whitelist plus
# well-known institution names). Used for typosquat distance checks.
PROTECTED_BRAND_LABELS: frozenset[str] = frozenset(
    {
        "tniad",
        "tni",
        "rekrutmen-tni",
        "rekrutmentni",
        "pussiberad",
        "kemhan",
        "akmil",
        "unhan",
        "unhanri",
        "seskoad",
        "sisfopers",
        "kartika",
    }
)

# Military bait tokens that should never appear on a non-official host.
MILITARY_BAIT_TOKENS: tuple[str, ...] = (
    "tni",
    "kartika",
    "pussiber",
    "bintara",
    "tamtama",
    "sisfopers",
    "kemhan",
    "mil-id",
    "milid",
    "rekrutmen",
    "panpus",
    "kodam",
    "prajurit",
)

# Visually confusable characters (digit/letter swaps commonly used in phishing).
_CONFUSABLES = str.maketrans(
    {
        # digit / symbol swaps
        "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a",
        # Cyrillic & Latin-extended homoglyphs seen in IDN phishing
        "а": "a", "е": "e", "о": "o", "і": "i", "ı": "i", "ӏ": "l", "р": "p", "с": "c",
        "у": "y", "х": "x", "ԁ": "d", "к": "k", "м": "m", "т": "t", "н": "h", "ո": "n",
    }
)


def _fold_confusables(label: str) -> str:
    """Map homoglyphs to ASCII and strip diacritics (e.g. 'tnïad' -> 'tniad')."""
    folded = label.translate(_CONFUSABLES)
    folded = unicodedata.normalize("NFKD", folded)
    return "".join(ch for ch in folded if not unicodedata.combining(ch))


@dataclass
class DomainAssessment:
    """Result of assessing a single URL/host against the whitelist."""

    host: str
    is_official: bool
    is_ip: bool = False
    is_punycode: bool = False
    scheme: str = ""
    bait_tokens: list[str] = field(default_factory=list)
    lookalike_of: Optional[str] = None
    lookalike_kind: Optional[str] = None  # 'embedded-official' | 'typosquat' | 'homoglyph' | 'fake-mil-tld'
    risk_score: float = 0.0
    reasons: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "host": self.host,
            "is_official": self.is_official,
            "is_ip": self.is_ip,
            "is_punycode": self.is_punycode,
            "scheme": self.scheme,
            "bait_tokens": list(self.bait_tokens),
            "lookalike_of": self.lookalike_of,
            "lookalike_kind": self.lookalike_kind,
            "risk_score": self.risk_score,
            "reasons": list(self.reasons),
        }


# --------------------------------------------------------------------------- #
# Normalisation helpers
# --------------------------------------------------------------------------- #
def parse_url(url_or_host: str) -> tuple[str, str]:
    """Return `(scheme, normalised_host)` for a URL or a bare host string."""
    raw = (url_or_host or "").strip()
    if not raw:
        return "", ""
    parsed = urlparse(raw if "://" in raw else f"https://{raw}")
    scheme = (parsed.scheme or "").lower()
    return scheme, normalize_host(parsed.hostname or "")


def normalize_host(hostname: str) -> str:
    """Lower-case, strip trailing dot / `www.` / port and decode IDN punycode."""
    host = (hostname or "").strip().lower().rstrip(".")
    if ":" in host and not host.startswith("["):
        host = host.split(":", 1)[0]
    if host.startswith("www."):
        host = host[4:]
    return host


def _decode_idna(host: str) -> str:
    if "xn--" not in host:
        return host
    try:
        return host.encode("ascii").decode("idna")
    except Exception:
        return host


def is_ip_address(hostname: str) -> bool:
    try:
        ipaddress.ip_address((hostname or "").strip("[]"))
        return True
    except ValueError:
        return False


def is_official_domain(hostname_or_url: str) -> bool:
    """True when the host equals or is a sub-domain of a whitelisted domain."""
    if not hostname_or_url:
        return False
    host = parse_url(hostname_or_url)[1]
    if not host or is_ip_address(host) or "xn--" in host:
        # Punycode never matches: the whitelist is pure ASCII.
        return False
    return any(host == d or host.endswith("." + d) for d in OFFICIAL_MIL_DOMAINS)


def _levenshtein(a: str, b: str, max_dist: int = 3) -> int:
    """Bounded Levenshtein distance (early exit once it exceeds `max_dist`)."""
    if abs(len(a) - len(b)) > max_dist:
        return max_dist + 1
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        row_min = cur[0]
        for j, cb in enumerate(b, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb))
            row_min = min(row_min, cur[j])
        if row_min > max_dist:
            return max_dist + 1
        prev = cur
    return prev[-1]


def _registrable_label(host: str) -> str:
    """Best-effort 'brand' label: the label left of the public suffix."""
    parts = host.split(".")
    if len(parts) >= 3 and parts[-2] in {"co", "go", "ac", "or", "my", "web", "sch", "mil", "net", "biz"} and parts[-1] == "id":
        return parts[-3]
    return parts[-2] if len(parts) >= 2 else host


def find_lookalike(host: str) -> tuple[Optional[str], Optional[str]]:
    """
    Detect whether a NON-official host imitates an official one.
    Returns `(imitated_domain_or_brand, kind)` or `(None, None)`.
    """
    if not host or is_official_domain(host):
        return None, None

    decoded = _decode_idna(host)

    # 1. Official domain embedded in an attacker host: tniad.mil.id.verify-login.com
    for official in sorted(OFFICIAL_MIL_DOMAINS, key=len, reverse=True):
        if official == "mil.id":
            continue
        if official in host or official.replace(".", "-") in host:
            return official, "embedded-official"

    # 2. Fake military TLD imitations: tniad-mil.id, tniad.mil-id.com, tniad.milid.co
    if (
        host.endswith("mil.id")  # e.g. evilmil.id / tniad-mil.id (not a real *.mil.id sub-domain)
        or ".mil.id." in f".{host}"  # e.g. mil.id.co / portal.mil.id.example.com
        or any(tok in host for tok in ("mil-id", "milid"))
    ):
        return "mil.id", "fake-mil-tld"

    # 3. Homoglyph / IDN: punycode host whose decoded form normalises to a brand
    label = _registrable_label(decoded)
    folded = _fold_confusables(label)
    if "xn--" in host or folded != label:
        for brand in PROTECTED_BRAND_LABELS:
            if folded == brand or (len(brand) >= 5 and brand in folded):
                return brand, "homoglyph"

    # 4. Typosquat: brand label within edit distance 1-2 (e.g. tnlad, tniadd, kemhann)
    for brand in PROTECTED_BRAND_LABELS:
        if len(brand) < 4:
            continue  # 'tni' is too short for edit distance (too many false positives)
        allowed = 2 if len(brand) >= 9 else 1
        dist = _levenshtein(folded, brand, max_dist=allowed)
        if 0 < dist <= allowed:
            return brand, "typosquat"
        if folded == brand:
            # exact brand label on a non-official suffix, e.g. tniad.com / kemhan.xyz
            return brand, "typosquat"

    return None, None


# --------------------------------------------------------------------------- #
# Public API
# --------------------------------------------------------------------------- #
def assess_url(url_or_host: str) -> DomainAssessment:
    """
    Assess a URL (or bare host) for domain-level phishing indicators.

    Score (0-100) for a non-official host:
      base 55 (outside whitelist) + 35 bait token / lookalike + 10 no HTTPS,
      punycode and raw-IP hosts add further evidence. Official hosts score 0.
    The scale intentionally matches the pre-existing QR/caption telemetry so
    image-scan verdicts stay comparable.
    """
    scheme, host = parse_url(url_or_host)
    assessment = DomainAssessment(host=host, is_official=False, scheme=scheme)
    if not host:
        return assessment

    if is_official_domain(host):
        assessment.is_official = True
        assessment.reasons.append(f"Domain resmi terverifikasi: {host}")
        return assessment

    assessment.is_ip = is_ip_address(host)
    assessment.is_punycode = "xn--" in host
    assessment.bait_tokens = [tok for tok in MILITARY_BAIT_TOKENS if tok in host]
    assessment.lookalike_of, assessment.lookalike_kind = find_lookalike(host)

    score = 55.0
    assessment.reasons.append(f"Tautan mengarah ke domain eksternal non-militer: '{host}'")

    if assessment.lookalike_of:
        score += 35.0
        kind_label = {
            "embedded-official": "menyisipkan nama domain resmi",
            "fake-mil-tld": "meniru akhiran .mil.id",
            "homoglyph": "menggunakan karakter mirip (homoglyph/IDN)",
            "typosquat": "typosquatting nama institusi",
        }.get(assessment.lookalike_kind or "", "meniru domain resmi")
        assessment.reasons.append(
            f"Domain '{host}' {kind_label} '{assessment.lookalike_of}' (indikasi penyamaran)"
        )
    elif assessment.bait_tokens:
        score += 35.0
        assessment.reasons.append(
            f"Indikasi typosquatting / penyamaran nama institusi militer pada domain '{host}'"
        )

    if assessment.is_punycode:
        score += 10.0
        assessment.reasons.append(f"Domain menggunakan IDN/punycode ('{_decode_idna(host)}')")
    if assessment.is_ip:
        score += 10.0
        assessment.reasons.append(f"Tautan menggunakan alamat IP mentah ('{host}') tanpa nama domain terdaftar")
    if scheme and scheme != "https":
        score += 10.0
        assessment.reasons.append("Tautan tidak menggunakan enkripsi HTTPS standar")

    assessment.risk_score = round(min(100.0, score), 2)
    return assessment
