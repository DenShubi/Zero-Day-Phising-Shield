"""
VisiKartika Shield - Domain Whitelist & Lookalike Guard (Phase 2+).

Single source of truth for:
  * the official TNI AD / TNI / Kemhan domain whitelist (`.mil.id` namespace),
  * host normalisation (case, trailing dot, port, `www.`, IDN/punycode),
  * lookalike / typosquatting heuristics against official domains,
  * generic phishing infrastructure indicators (high-abuse TLDs, URL shorteners,
    ephemeral tunnels, raw IPs, non-TLS) vs legitimate non-military domains.
"""

from __future__ import annotations

import ipaddress
import re
import unicodedata
from dataclasses import dataclass, field
from typing import Optional
from urllib.parse import urlparse

# --------------------------------------------------------------------------- #
# Whitelist
# --------------------------------------------------------------------------- #
OFFICIAL_MIL_DOMAINS: frozenset[str] = frozenset(
    {
        "mil.id",
        "tniad.mil.id",
        "tni.mil.id",
        "rekrutmen-tni.mil.id",
        "pussiberad.mil.id",
        "seskoad.mil.id",
        "kostrad.mil.id",
        "kopassus.mil.id",
        "kemhan.go.id",
        "bssn.go.id",
        "lemhannas.go.id",
        "bakamla.go.id",
        "basarnas.go.id",
        "akmil.ac.id",
        "poltekad.ac.id",
        "aal.ac.id",
        "aau.ac.id",
        "idu.ac.id",
        "unhanri.ac.id",
    }
)

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

# Military bait tokens (checked on label/token boundaries so 'family.com' or 'kartini.com' never false-match)
MILITARY_BAIT_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("tniad", re.compile(r"tniad", re.IGNORECASE)),
    ("tni", re.compile(r"(?:^|[-_./0-9])tni(?:ad)?(?:$|[-_./0-9])", re.IGNORECASE)),
    ("kartika", re.compile(r"kartika", re.IGNORECASE)),
    ("pussiber", re.compile(r"pussiber", re.IGNORECASE)),
    ("bintara", re.compile(r"bintara", re.IGNORECASE)),
    ("tamtama", re.compile(r"tamtama", re.IGNORECASE)),
    ("sisfopers", re.compile(r"sisfopers", re.IGNORECASE)),
    ("kemhan", re.compile(r"kemhan", re.IGNORECASE)),
    ("mil-id", re.compile(r"mil[-_]?id", re.IGNORECASE)),
    ("rekrutmen", re.compile(r"rekrutmen", re.IGNORECASE)),
    ("panpus", re.compile(r"panpus", re.IGNORECASE)),
    ("kodam", re.compile(r"kodam", re.IGNORECASE)),
    ("prajurit", re.compile(r"prajurit", re.IGNORECASE)),
    ("akmil", re.compile(r"akmil", re.IGNORECASE)),
    ("seskoad", re.compile(r"seskoad", re.IGNORECASE)),
)

HIGH_ABUSE_TLDS: frozenset[str] = frozenset(
    {
        "xyz", "top", "click", "vip", "icu", "buzz", "monster", "link",
        "online", "site", "live", "shop", "cc", "pw", "tk", "ml", "ga", "cf", "gq",
    }
)

URL_SHORTENER_HOSTS: frozenset[str] = frozenset(
    {
        "bit.ly", "s.id", "tinyurl.com", "cutt.ly", "rb.gy",
        "is.gd", "rebrand.ly", "shorturl.at", "t.co", "lnkd.in",
    }
)

EPHEMERAL_TUNNEL_OR_FREE_HOSTS: tuple[str, ...] = (
    "ngrok-free.app",
    "ngrok.io",
    "trycloudflare.com",
    "lhr.life",
    "loca.lt",
    "000webhostapp.com",
    "weebly.com",
    "blogspot.com",
    "pages.dev",
    "vercel.app",
    "netlify.app",
    "web.app",
    "firebaseapp.com",
)

_CONFUSABLES = str.maketrans(
    {
        "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a",
        "а": "a", "е": "e", "о": "o", "і": "i", "ı": "i", "ӏ": "l", "р": "p", "с": "c",
        "у": "y", "х": "x", "ԁ": "d", "к": "k", "м": "m", "т": "t", "н": "h", "ո": "n",
    }
)


def _fold_confusables(label: str) -> str:
    folded = label.translate(_CONFUSABLES)
    folded = unicodedata.normalize("NFKD", folded)
    return "".join(ch for ch in folded if not unicodedata.combining(ch))


@dataclass
class DomainAssessment:
    """Result of assessing a single URL/host against the whitelist & threat heuristics."""

    host: str
    is_official: bool
    is_ip: bool = False
    is_punycode: bool = False
    is_shortener: bool = False
    is_free_or_tunnel_host: bool = False
    is_high_abuse_tld: bool = False
    scheme: str = ""
    bait_tokens: list[str] = field(default_factory=list)
    lookalike_of: Optional[str] = None
    lookalike_kind: Optional[str] = None
    risk_score: float = 0.0
    reasons: list[str] = field(default_factory=list)

    @property
    def has_phishing_indicators(self) -> bool:
        """True if domain exhibits explicit threat signals beyond simply being non-.mil.id."""
        return bool(
            self.lookalike_of
            or self.bait_tokens
            or self.is_shortener
            or self.is_free_or_tunnel_host
            or self.is_high_abuse_tld
            or self.is_punycode
            or self.is_ip
            or (self.scheme and self.scheme != "https")
        )

    def as_dict(self) -> dict:
        return {
            "host": self.host,
            "is_official": self.is_official,
            "is_ip": self.is_ip,
            "is_punycode": self.is_punycode,
            "is_shortener": self.is_shortener,
            "is_free_or_tunnel_host": self.is_free_or_tunnel_host,
            "is_high_abuse_tld": self.is_high_abuse_tld,
            "scheme": self.scheme,
            "bait_tokens": list(self.bait_tokens),
            "lookalike_of": self.lookalike_of,
            "lookalike_kind": self.lookalike_kind,
            "risk_score": self.risk_score,
            "reasons": list(self.reasons),
        }


def parse_url(url_or_host: str) -> tuple[str, str]:
    raw = (url_or_host or "").strip()
    if not raw:
        return "", ""
    parsed = urlparse(raw if "://" in raw else f"https://{raw}")
    scheme = (parsed.scheme or "").lower()
    return scheme, normalize_host(parsed.hostname or "")


def normalize_host(hostname: str) -> str:
    host = (hostname or "").strip().lower().rstrip(".")
    if ":" in host and not host.startswith("["):
        host = host.split(":", 1)[0]
    if host.startswith("www."):
        host = host[4:]
    return host


def registrable_domain(hostname: str) -> str:
    """Approximate eTLD+1 (e.g. 'assets.github.com' -> 'github.com', 'ad.rekrutmen-tni.mil.id' -> 'rekrutmen-tni.mil.id')."""
    host = normalize_host(hostname)
    parts = host.split(".")
    if len(parts) >= 3 and parts[-2] in {"co", "go", "ac", "or", "my", "web", "sch", "mil", "net", "biz"} and parts[-1] == "id":
        return ".".join(parts[-3:])
    if len(parts) >= 2:
        return ".".join(parts[-2:])
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
    if not hostname_or_url:
        return False
    host = parse_url(hostname_or_url)[1]
    if not host or is_ip_address(host) or "xn--" in host:
        return False
    return any(host == d or host.endswith("." + d) for d in OFFICIAL_MIL_DOMAINS)


def find_bait_tokens(text_or_host: str) -> list[str]:
    if not text_or_host:
        return []
    return [name for name, pat in MILITARY_BAIT_PATTERNS if pat.search(text_or_host)]


def _levenshtein(a: str, b: str, max_dist: int = 3) -> int:
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
    parts = host.split(".")
    if len(parts) >= 3 and parts[-2] in {"co", "go", "ac", "or", "my", "web", "sch", "mil", "net", "biz"} and parts[-1] == "id":
        return parts[-3]
    return parts[-2] if len(parts) >= 2 else host


def find_lookalike(host: str) -> tuple[Optional[str], Optional[str]]:
    if not host or is_official_domain(host):
        return None, None

    decoded = _decode_idna(host)

    for official in sorted(OFFICIAL_MIL_DOMAINS, key=len, reverse=True):
        if official == "mil.id":
            continue
        if official in host or official.replace(".", "-") in host:
            return official, "embedded-official"

    if (
        host.endswith("mil.id")
        or ".mil.id." in f".{host}"
        or any(tok in host for tok in ("mil-id", "milid"))
    ):
        return "mil.id", "fake-mil-tld"

    label = _registrable_label(decoded)
    folded = _fold_confusables(label)
    if "xn--" in host or folded != label:
        for brand in PROTECTED_BRAND_LABELS:
            if folded == brand or (len(brand) >= 5 and brand in folded):
                return brand, "homoglyph"

    for brand in PROTECTED_BRAND_LABELS:
        if len(brand) < 4:
            continue
        allowed = 2 if len(brand) >= 9 else 1
        dist = _levenshtein(folded, brand, max_dist=allowed)
        if 0 < dist <= allowed:
            return brand, "typosquat"
        if folded == brand:
            return brand, "typosquat"

    return None, None


def assess_url(url_or_host: str, *, military_context: bool = True) -> DomainAssessment:
    """
    Assess a URL (or bare host) for domain-level phishing indicators.
      - Official `.mil.id` / `.go.id` whitelist -> 0.0
      - Non-official domain under default/military guard (`military_context=True`) -> 55.0 base
      - Clean legitimate HTTPS non-military domain when `military_context=False` -> 15.0 base
      - Lookalike / typosquat / bait / shortener / tunnel / high-abuse TLD / IP / HTTP -> 55.0 - 100.0
    """
    raw = (url_or_host or "").strip()
    scheme, host = parse_url(raw)
    assessment = DomainAssessment(host=host, is_official=False, scheme=scheme)
    if not host:
        return assessment

    if is_official_domain(host):
        assessment.is_official = True
        assessment.reasons.append(f"Domain resmi terverifikasi: {host}")
        return assessment

    assessment.is_ip = is_ip_address(host)
    assessment.is_punycode = "xn--" in host
    assessment.is_shortener = host in URL_SHORTENER_HOSTS
    assessment.is_free_or_tunnel_host = any(
        host == d or host.endswith("." + d) for d in EPHEMERAL_TUNNEL_OR_FREE_HOSTS
    )
    tld = host.rsplit(".", 1)[-1] if "." in host else ""
    assessment.is_high_abuse_tld = tld in HIGH_ABUSE_TLDS

    # Check bait tokens in both hostname and URL path
    assessment.bait_tokens = find_bait_tokens(raw.lower())
    assessment.lookalike_of, assessment.lookalike_kind = find_lookalike(host)

    # Base score: low (15) for clean general non-military HTTPS domains, high (55) if military context is claimed
    score = 55.0 if military_context else 15.0

    if assessment.lookalike_of:
        score = max(score, 55.0) + 35.0
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
        score = max(score, 55.0) + 35.0
        assessment.reasons.append(
            f"Penggunaan kata kunci institusi militer ({', '.join(assessment.bait_tokens[:3])}) pada domain non-resmi '{host}'"
        )

    if assessment.is_shortener:
        score += 40.0
        assessment.reasons.append(f"Tautan menggunakan penyingkat URL ('{host}') yang menyembunyikan domain tujuan asli")
    if assessment.is_free_or_tunnel_host:
        score += 35.0
        assessment.reasons.append(f"Tautan menggunakan layanan hosting gratis / tunnel sementara ('{host}')")
    if assessment.is_high_abuse_tld:
        score += 30.0
        assessment.reasons.append(f"Domain menggunakan ekstensi TLD berisiko tinggi ('.{tld}')")
    if assessment.is_punycode:
        score += 25.0
        assessment.reasons.append(f"Domain menggunakan IDN/punycode ('{_decode_idna(host)}')")
    if assessment.is_ip or host in ("localhost", "127.0.0.1"):
        score += 35.0
        assessment.reasons.append(f"Tautan menggunakan alamat IP mentah / host lokal ('{host}')")
    if scheme and scheme != "https":
        score += 25.0
        assessment.reasons.append(f"Tautan tidak menggunakan enkripsi HTTPS standar (skema '{scheme}://')")

    if military_context and not assessment.reasons:
        assessment.reasons.append(f"Konten bermuatan atribut militer mengarah ke domain eksternal non-.mil.id: '{host}'")

    assessment.risk_score = round(min(100.0, score), 2)
    return assessment
