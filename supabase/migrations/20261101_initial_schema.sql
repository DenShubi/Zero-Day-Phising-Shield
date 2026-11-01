CREATE TABLE IF NOT EXISTS official_portals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    portal_name VARCHAR(150) NOT NULL,
    official_domain VARCHAR(255) NOT NULL,
    reference_screenshot_url TEXT NOT NULL,
    dom_signature JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scan_incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submitted_url TEXT,
    reporter_source VARCHAR(50) DEFAULT 'WEB_SANDBOX', 
    reporter_unit VARCHAR(100) DEFAULT 'Simulasi Juri / Satuan Jajaran',

    total_risk_score NUMERIC(5,2) NOT NULL,
    visual_similarity_score NUMERIC(5,2) NOT NULL,
    dom_anomaly_score NUMERIC(5,2) NOT NULL,
    domain_telemetry_score NUMERIC(5,2) NOT NULL,

    verdict VARCHAR(30) NOT NULL,             
    impersonated_target VARCHAR(150),
    captured_screenshot_url TEXT,
    annotated_bbox_url TEXT,
    detected_logos JSONB,
    dom_findings JSONB,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER PUBLICATION supabase_realtime ADD TABLE scan_incidents;
