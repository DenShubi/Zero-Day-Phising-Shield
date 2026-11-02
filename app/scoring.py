"""
VisiKartika Shield - Multi-Indicator Risk Fusion Engine (Phase 2, Person B).

    Total Risk = 0.45 * Visual Similarity + 0.30 * DOM Anomaly + 0.25 * Domain Telemetry

plus deterministic override rules (Identity-Domain Mismatch, Quishing) and the
verdict thresholds. Every scan path (URL sandbox, screenshot/poster image, WA
bot) goes through this module so the formula lives in exactly one place and
the SOC dashboard / WhatsApp replies always agree.
"""

from __future__ import annotations

from dataclasses import dataclass, field

WEIGHT_VISUAL = 0.45
WEIGHT_DOM = 0.30
WEIGHT_DOMAIN = 0.25

THRESHOLD_CRITICAL = 70.0
THRESHOLD_SUSPICIOUS = 40.0

# Override floors
FLOOR_IDENTITY_DOMAIN_MISMATCH = 92.0  # official logo + non-.mil.id + credential harvesting (URL scan)
FLOOR_QUISHING_WITH_LOGO = 90.0        # official logo + QR to non-official URL (image scan)
FLOOR_LOGO_LOOKALIKE_IMAGE = 78.0      # official logo + >=80% visual match, no official URL (image scan)

VERDICT_SAFE = "SAFE"
VERDICT_SUSPICIOUS = "SUSPICIOUS"
VERDICT_CRITICAL = "CRITICAL_PHISHING"


@dataclass
class RiskDecision:
    total_risk_score: float
    verdict: str
    weighted_score: float
    applied_rules: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "total_risk_score": self.total_risk_score,
            "verdict": self.verdict,
            "weighted_score": self.weighted_score,
            "applied_rules": list(self.applied_rules),
            "weights": {"visual": WEIGHT_VISUAL, "dom": WEIGHT_DOM, "domain": WEIGHT_DOMAIN},
        }


def _clamp(value: float) -> float:
    return max(0.0, min(100.0, float(value or 0.0)))


def weighted_score(visual: float, dom: float, domain: float) -> float:
    """Pure 45/30/25 weighted sum, each input clamped to 0-100."""
    return round(
        WEIGHT_VISUAL * _clamp(visual) + WEIGHT_DOM * _clamp(dom) + WEIGHT_DOMAIN * _clamp(domain),
        2,
    )


def classify(total_risk: float) -> str:
    """Map a 0-100 total risk score to the verdict label."""
    if total_risk >= THRESHOLD_CRITICAL:
        return VERDICT_CRITICAL
    if total_risk >= THRESHOLD_SUSPICIOUS:
        return VERDICT_SUSPICIOUS
    return VERDICT_SAFE


def fuse_url_scan(
    *,
    visual: float,
    dom: float,
    domain: float,
    is_official_domain: bool,
    has_cross_origin_form: bool,
    has_official_logo: bool,
    has_credential_harvesting: bool,
) -> RiskDecision:
    """Risk fusion for a live URL captured in the headless sandbox."""
    base = weighted_score(visual, dom, domain)

    if is_official_domain and not has_cross_origin_form:
        return RiskDecision(
            total_risk_score=0.0,
            verdict=VERDICT_SAFE,
            weighted_score=base,
            applied_rules=["OFFICIAL_WHITELIST: domain resmi .mil.id/.go.id tanpa form lintas-origin"],
        )

    total = base
    rules: list[str] = []
    if has_official_logo and not is_official_domain and has_credential_harvesting:
        if total < FLOOR_IDENTITY_DOMAIN_MISMATCH:
            rules.append(
                f"IDENTITY_DOMAIN_MISMATCH: logo resmi + domain non-resmi + input kredensial (skor min {FLOOR_IDENTITY_DOMAIN_MISMATCH:.0f})"
            )
        total = max(total, FLOOR_IDENTITY_DOMAIN_MISMATCH)

    total = round(total, 2)
    return RiskDecision(total_risk_score=total, verdict=classify(total), weighted_score=base, applied_rules=rules)


def fuse_image_scan(
    *,
    visual: float,
    dom: float,
    domain: float,
    has_official_logo: bool,
    has_qr_code: bool,
    extracted_urls_total: int,
    extracted_urls_official: int,
) -> RiskDecision:
    """Risk fusion for an uploaded screenshot / poster (QR + logo + layout)."""
    base = weighted_score(visual, dom, domain)
    any_official_url = extracted_urls_official > 0

    if extracted_urls_total > 0 and extracted_urls_official == extracted_urls_total:
        return RiskDecision(
            total_risk_score=0.0,
            verdict=VERDICT_SAFE,
            weighted_score=base,
            applied_rules=["OFFICIAL_WHITELIST: seluruh tautan/QR mengarah ke domain resmi"],
        )

    total = base
    rules: list[str] = []
    if has_official_logo and has_qr_code and not any_official_url:
        if total < FLOOR_QUISHING_WITH_LOGO:
            rules.append(
                f"QUISHING_IMPERSONATION: logo resmi + QR ke domain non-resmi (skor min {FLOOR_QUISHING_WITH_LOGO:.0f})"
            )
        total = max(total, FLOOR_QUISHING_WITH_LOGO)
    elif has_official_logo and _clamp(visual) >= 80.0 and not any_official_url:
        if total < FLOOR_LOGO_LOOKALIKE_IMAGE:
            rules.append(
                f"VISUAL_IMPERSONATION: logo resmi + kemiripan visual >= 80% (skor min {FLOOR_LOGO_LOOKALIKE_IMAGE:.0f})"
            )
        total = max(total, FLOOR_LOGO_LOOKALIKE_IMAGE)

    total = round(total, 2)
    return RiskDecision(total_risk_score=total, verdict=classify(total), weighted_score=base, applied_rules=rules)
