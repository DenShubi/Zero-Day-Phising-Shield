"""
VisiKartika Shield - Multi-Indicator Risk Fusion Engine (Phase 2+).

    Total Risk = 0.45 * Visual Similarity + 0.30 * DOM Anomaly + 0.25 * Domain Telemetry

plus deterministic context-aware override rules for:
  * Official `.mil.id`/`.go.id` portal & official recruitment poster whitelist,
  * Identity-Domain Mismatch (logo + non-.mil.id + credential harvesting),
  * Poster Quishing, Text-URL Impersonation, & Calo/Fee Recruitment Scams,
  * Static Screenshot Login Impersonation & Generic Non-TNI Phishing,
  * Benign Military Graphics (commemorative/educational posters without links/forms/scams).
"""

from __future__ import annotations

from dataclasses import dataclass, field

WEIGHT_VISUAL = 0.45
WEIGHT_DOM = 0.30
WEIGHT_DOMAIN = 0.25

THRESHOLD_CRITICAL = 70.0
THRESHOLD_SUSPICIOUS = 40.0

# Override floors & caps
FLOOR_IDENTITY_DOMAIN_MISMATCH = 92.0  # official logo + non-.mil.id + credential harvesting (URL scan)
FLOOR_RECRUITMENT_SCAM_POSTER = 92.0   # military logo/context + calo/fee/APK scam text (poster/image)
FLOOR_QUISHING_WITH_LOGO = 90.0        # military logo/context + QR to non-official URL
FLOOR_TEXT_URL_IMPERSONATION = 86.0    # military logo/context + printed non-official URL
FLOOR_SCREENSHOT_LOGIN_PHISH = 86.0    # military logo/context + login form boxes/cues without official URL
FLOOR_LOGO_LOOKALIKE_IMAGE = 78.0      # official logo + >=80% portal visual match, no official URL
FLOOR_GENERIC_SCAM_CONTENT = 78.0      # APK malware / OTP harvesting / high-risk QR phishing (even non-TNI)
FLOOR_PERSONAL_WA_RECRUITMENT = 74.0   # military poster soliciting registration via personal 08/+62 WA
FLOOR_GENERIC_CRED_PHISHING = 72.0     # non-TNI credential harvesting on high-risk infrastructure
CAP_BENIGN_MILITARY_GRAPHIC = 22.0     # commemorative/educational TNI poster with zero links/QR/forms/scam

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
    has_generic_phishing_infra: bool = False,
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
    elif has_credential_harvesting and has_generic_phishing_infra and _clamp(dom) >= 40.0 and _clamp(domain) >= 45.0:
        if total < FLOOR_GENERIC_CRED_PHISHING:
            rules.append(
                f"GENERIC_CREDENTIAL_PHISHING: form login/kredensial pada domain berisiko tinggi (skor min {FLOOR_GENERIC_CRED_PHISHING:.0f})"
            )
        total = max(total, FLOOR_GENERIC_CRED_PHISHING)

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
    has_military_context: bool = False,
    has_scam_text: bool = False,
    has_login_form_cues: bool = False,
    has_personal_contact: bool = False,
    has_high_risk_url: bool = False,
) -> RiskDecision:
    """Risk fusion for an uploaded screenshot / poster (QR + OCR + logo + visual layout)."""
    base = weighted_score(visual, dom, domain)
    any_official_url = extracted_urls_official > 0
    mil_identity = has_official_logo or has_military_context

    # 1. All extracted URLs/QRs point strictly to official .mil.id / .go.id domains (and no calo/fee fraud text)
    if (
        extracted_urls_total > 0
        and extracted_urls_official == extracted_urls_total
        and not has_scam_text
        and not has_personal_contact
    ):
        return RiskDecision(
            total_risk_score=0.0,
            verdict=VERDICT_SAFE,
            weighted_score=base,
            applied_rules=["OFFICIAL_WHITELIST: seluruh tautan/QR mengarah ke domain resmi"],
        )

    total = base
    rules: list[str] = []

    # 2. Recruitment calo / administration-fee / APK scam with military attributes
    if mil_identity and has_scam_text:
        if total < FLOOR_RECRUITMENT_SCAM_POSTER:
            rules.append(
                f"RECRUITMENT_SCAM_POSTER: atribut militer + indikasi pungutan biaya/jalur khusus/APK (skor min {FLOOR_RECRUITMENT_SCAM_POSTER:.0f})"
            )
        total = max(total, FLOOR_RECRUITMENT_SCAM_POSTER)

    # 3. Military Quishing (QR code leading outside .mil.id / .go.id)
    elif mil_identity and has_qr_code and not any_official_url:
        if total < FLOOR_QUISHING_WITH_LOGO:
            rules.append(
                f"QUISHING_IMPERSONATION: atribut militer + QR ke domain non-resmi (skor min {FLOOR_QUISHING_WITH_LOGO:.0f})"
            )
        total = max(total, FLOOR_QUISHING_WITH_LOGO)

    # 4. Military Poster/Screenshot printing an external non-official URL
    elif mil_identity and extracted_urls_total > 0 and not any_official_url:
        if total < FLOOR_TEXT_URL_IMPERSONATION:
            rules.append(
                f"TEXT_URL_IMPERSONATION: atribut militer + tautan teks ke domain non-resmi (skor min {FLOOR_TEXT_URL_IMPERSONATION:.0f})"
            )
        total = max(total, FLOOR_TEXT_URL_IMPERSONATION)

    # 5. Static Screenshot of a Military Login/Credential Page without verified official URL
    elif mil_identity and has_login_form_cues and not any_official_url:
        if total < FLOOR_SCREENSHOT_LOGIN_PHISH:
            rules.append(
                f"SCREENSHOT_LOGIN_IMPERSONATION: form login/kredensial mencatut atribut militer tanpa domain resmi (skor min {FLOOR_SCREENSHOT_LOGIN_PHISH:.0f})"
            )
        total = max(total, FLOOR_SCREENSHOT_LOGIN_PHISH)

    # 6. Military Poster soliciting contact via personal 08/+62 WhatsApp number
    elif mil_identity and has_personal_contact and not any_official_url:
        if total < FLOOR_PERSONAL_WA_RECRUITMENT:
            rules.append(
                f"UNVERIFIED_MILITARY_CONTACT: atribut militer mengarahkan pendaftaran ke nomor pribadi (skor min {FLOOR_PERSONAL_WA_RECRUITMENT:.0f})"
            )
        total = max(total, FLOOR_PERSONAL_WA_RECRUITMENT)

    # 7. High-fidelity clone (>= 80% visual layout similarity + official logo, no official URL)
    elif has_official_logo and _clamp(visual) >= 80.0 and not any_official_url:
        if total < FLOOR_LOGO_LOOKALIKE_IMAGE:
            rules.append(
                f"VISUAL_IMPERSONATION: logo resmi + kemiripan visual >= 80% (skor min {FLOOR_LOGO_LOOKALIKE_IMAGE:.0f})"
            )
        total = max(total, FLOOR_LOGO_LOOKALIKE_IMAGE)

    # 8. Generic Non-TNI Scam / APK Malware / High-Risk Phishing QR or Screenshot
    elif has_scam_text or (has_qr_code and has_high_risk_url) or (has_login_form_cues and has_high_risk_url):
        if total < FLOOR_GENERIC_SCAM_CONTENT:
            rules.append(
                f"GENERIC_SCAM_OR_PHISHING: terdeteksi pola penipuan siber/APK/tautan phishing umum (skor min {FLOOR_GENERIC_SCAM_CONTENT:.0f})"
            )
        total = max(total, FLOOR_GENERIC_SCAM_CONTENT)

    # 9. Benign Military Graphic / Commemorative Poster (TNI logo/text, NO external URLs, NO QR, NO login boxes, NO scam/WA)
    elif (
        mil_identity
        and extracted_urls_total == 0
        and not has_qr_code
        and not has_scam_text
        and not has_login_form_cues
        and not has_personal_contact
        and _clamp(visual) < 80.0
    ):
        if total > CAP_BENIGN_MILITARY_GRAPHIC:
            rules.append(
                f"BENIGN_MILITARY_GRAPHIC: publikasi/poster atribut militer informatif tanpa tautan eksternal, QR, atau permintaan kredensial (skor maks {CAP_BENIGN_MILITARY_GRAPHIC:.0f})"
            )
        total = min(total, CAP_BENIGN_MILITARY_GRAPHIC)

    total = round(total, 2)
    return RiskDecision(total_risk_score=total, verdict=classify(total), weighted_score=base, applied_rules=rules)
