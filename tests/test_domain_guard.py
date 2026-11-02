import pytest

from app.domain_guard import assess_url, find_lookalike, is_official_domain


@pytest.mark.parametrize(
    "url",
    [
        "https://tniad.mil.id",
        "https://ad.rekrutmen-tni.mil.id/login",
        "http://WWW.TNIAD.MIL.ID.:443/path",
        "https://pussiberad.mil.id",
        "https://www.kemhan.go.id",
        "akmil.ac.id",
    ],
)
def test_official_domains(url):
    assert is_official_domain(url)
    a = assess_url(url)
    assert a.is_official and a.risk_score == 0.0


@pytest.mark.parametrize(
    "url,kind",
    [
        ("https://tniad.mil.id.verify-login.com", "embedded-official"),
        ("https://pussiberad.mil.id-secure.net", "embedded-official"),
        ("https://tniad-mil.id", "fake-mil-tld"),
        ("https://evilmil.id", "fake-mil-tld"),
        ("https://mil.id.co", "fake-mil-tld"),
        ("https://tnlad.com", "typosquat"),
        ("https://t1niad.com", "typosquat"),
        ("https://kemhann.xyz", "typosquat"),
        ("https://" + "tnïad.com".encode("idna").decode(), "homoglyph"),
        ("https://" + "kеmhan.com".encode("idna").decode(), "homoglyph"),  # Cyrillic 'е'
    ],
)
def test_lookalikes_detected(url, kind):
    a = assess_url(url)
    assert not a.is_official
    assert a.lookalike_kind == kind
    assert a.risk_score >= 90.0


@pytest.mark.parametrize("url", ["https://google.com", "https://kartini.com", "https://gmail.com", "https://tokopedia.com"])
def test_benign_domains_not_flagged_as_lookalike(url):
    a = assess_url(url)
    assert not a.is_official
    assert a.lookalike_of is None
    assert a.risk_score == 55.0  # outside whitelist only


def test_bait_keyword_domain_matches_legacy_scale():
    # Legacy QR telemetry: 55 base + 35 bait = 90 (https) — keep image verdicts comparable.
    a = assess_url("https://rekrutmen-bintara-tniad.com/verifikasi-nrp")
    assert a.risk_score == 90.0
    assert {"tni", "bintara", "rekrutmen"} <= set(a.bait_tokens)


def test_suffix_attack_is_not_official():
    assert not is_official_domain("https://faketniad.mil.id.attacker.com")
    assert not is_official_domain("https://xtniad.com")
    assert find_lookalike("tniad.mil.id") == (None, None)
