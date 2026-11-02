import pytest

from app.wa_triage import (
    InboundMessage,
    classify_message,
    extract_target_url,
    validate_chat_target_url,
)


def _msg(text="", **kw):
    return InboundMessage(channel="TEST", sender="t", text=text, **kw)


@pytest.mark.parametrize(
    "text,expected",
    [
        ("cek https://tniad-mil.id/login ya", "https://tniad-mil.id/login"),
        ("link: rekrutmen-tni-ad.com/daftar.", "https://rekrutmen-tni-ad.com/daftar"),
        ("buka www.contoh.co.id sekarang", "https://www.contoh.co.id"),
        ("halo komandan", None),
        ("file:///C:/Users/denin/.ssh/id_rsa", None),
    ],
)
def test_extract_target_url(text, expected):
    assert extract_target_url(text) == expected


def test_classification_lanes():
    assert classify_message(_msg("https://x-tni.com"))[0] == "URL"
    assert classify_message(_msg("lihat https://cdn.site.com/poster.jpg"))[0] == "IMAGE"
    assert classify_message(_msg("", media_bytes=b"\x89PNG"))[0] == "IMAGE"
    assert classify_message(_msg("https://x.com", media_bytes=b"\x89PNG"))[0] == "IMAGE"  # image wins
    assert classify_message(_msg("", has_unreadable_media=True))[0] == "MEDIA_UNREADABLE"
    assert classify_message(_msg("/portal"))[0] == "COMMAND"
    assert classify_message(_msg("Status"))[0] == "COMMAND"
    assert classify_message(_msg("darurat"))[0] == "COMMAND"
    assert classify_message(_msg("selamat pagi"))[0] == "HELP"
    assert classify_message(_msg(""))[0] == "IGNORED"


@pytest.mark.parametrize(
    "url,allowed",
    [
        ("http://127.0.0.1:8000/mock-targets/rekrutmen_bintara_phish.html", True),
        ("http://localhost:8000/mock-targets/sso_sisfopers_phish.html", True),
        ("http://localhost:2785/api/sessions", False),          # OpenWA admin API
        ("http://127.0.0.1:8000/docs", False),
        ("http://169.254.169.254/latest/meta-data/", False),     # cloud metadata
        ("http://10.0.0.5/login", False),
        ("http://192.168.1.1/", False),
        ("file:///etc/passwd", False),
        ("ftp://tniad.mil.id", False),
    ],
)
def test_chat_url_ssrf_guard(url, allowed):
    assert validate_chat_target_url(url)[0] is allowed
