from app import scoring


def test_weights_sum_to_one():
    assert abs(scoring.WEIGHT_VISUAL + scoring.WEIGHT_DOM + scoring.WEIGHT_DOMAIN - 1.0) < 1e-9


def test_weighted_formula_and_clamping():
    assert scoring.weighted_score(100, 100, 100) == 100.0
    assert scoring.weighted_score(0, 0, 0) == 0.0
    assert scoring.weighted_score(99.0, 100.0, 100.0) == 99.55  # baseline: rekrutmen_bintara_phish
    assert scoring.weighted_score(150, -10, 50) == round(0.45 * 100 + 0 + 0.25 * 50, 2)


def test_thresholds():
    assert scoring.classify(70.0) == "CRITICAL_PHISHING"
    assert scoring.classify(69.99) == "SUSPICIOUS"
    assert scoring.classify(40.0) == "SUSPICIOUS"
    assert scoring.classify(39.99) == "SAFE"


def test_url_official_whitelist_short_circuits():
    d = scoring.fuse_url_scan(visual=100, dom=100, domain=100, is_official_domain=True,
                              has_cross_origin_form=False, has_official_logo=True, has_credential_harvesting=True)
    assert d.verdict == "SAFE" and d.total_risk_score == 0.0 and d.applied_rules


def test_url_official_with_cross_origin_form_is_scored():
    d = scoring.fuse_url_scan(visual=90, dom=80, domain=0, is_official_domain=True,
                              has_cross_origin_form=True, has_official_logo=False, has_credential_harvesting=True)
    assert d.total_risk_score == scoring.weighted_score(90, 80, 0)


def test_identity_domain_mismatch_floor():
    # baseline kemhan_auth_phish: weighted 0.45*96.3+30+13.75 = 87.09 -> floored to 92
    d = scoring.fuse_url_scan(visual=96.3, dom=100, domain=55, is_official_domain=False,
                              has_cross_origin_form=True, has_official_logo=True, has_credential_harvesting=True)
    assert d.total_risk_score == 92.0 and d.verdict == "CRITICAL_PHISHING"
    assert any("IDENTITY_DOMAIN_MISMATCH" in r for r in d.applied_rules)


def test_no_floor_without_credential_harvesting():
    d = scoring.fuse_url_scan(visual=30, dom=10, domain=55, is_official_domain=False,
                              has_cross_origin_form=False, has_official_logo=True, has_credential_harvesting=False)
    assert d.total_risk_score == scoring.weighted_score(30, 10, 55)
    assert d.verdict == "SAFE"


def test_image_all_official_urls_safe():
    d = scoring.fuse_image_scan(visual=99, dom=85, domain=0, has_official_logo=True, has_qr_code=True,
                                extracted_urls_total=1, extracted_urls_official=1)
    assert d.verdict == "SAFE"


def test_image_quishing_floor():
    d = scoring.fuse_image_scan(visual=20, dom=85, domain=90, has_official_logo=True, has_qr_code=True,
                                extracted_urls_total=1, extracted_urls_official=0)
    assert d.total_risk_score == 90.0 and d.verdict == "CRITICAL_PHISHING"


def test_image_mixed_urls_not_safe():
    d = scoring.fuse_image_scan(visual=99, dom=85, domain=90, has_official_logo=True, has_qr_code=True,
                                extracted_urls_total=2, extracted_urls_official=1)
    assert d.verdict == "CRITICAL_PHISHING"
    assert d.total_risk_score == scoring.weighted_score(99, 85, 90)  # 'any official' blocks the floor, like before


def test_image_visual_impersonation_floor():
    d = scoring.fuse_image_scan(visual=82, dom=10, domain=10, has_official_logo=True, has_qr_code=False,
                                extracted_urls_total=0, extracted_urls_official=0)
    assert d.total_risk_score == 78.0
