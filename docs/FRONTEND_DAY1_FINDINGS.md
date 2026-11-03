# Day 1 empirical findings (verified against the running engine)

## 1. Bounding-box coordinate spaces — CONFIRMED
- **URL scans: 1280x720.** `page.screenshot(full_page=False)` at `app/sandbox/browser.py:494`.
- **Image scans: the source image's OWN pixel space.** Proven by rescaling test:
  same poster at 1280x720 -> QR bbox {x:897,y:337,w:227,h:227};
  at 800x450 -> {x:560,y:210,w:142,h:142}. Ratio 0.625 exactly.
- => `BBoxOverlay` MUST take an explicit `sourceSpace`; image scans read
  `naturalWidth`/`naturalHeight` on load. A hardcoded 16:9 would be wrong.

## 2. dom_findings layout differs from the plan's assumption
- `applied_rules` is at **`dom_findings.risk_fusion.applied_rules`**, NOT `dom_findings.applied_rules`.
- `risk_fusion` also persists **`weighted_score`** (pre-override base) alongside
  `total_risk_score` => the score-explainability delta panel works on COLD rows,
  no recomputation needed. e.g. weighted 46.5 -> total 78.0.
- `latency_breakdown_ms` absent from all 23 existing rows. Treat as optional.

## 3. Cold forensics is LESS degraded than planned
URL-scan rows persist `dom_findings.forms[].bbox` and
`dom_findings.sensitive_inputs[].bbox`, plus `final_url`, `page_title`,
`status_code`, `redirect_chain`, `external_domains_contacted`,
`detected_military_keywords`, `forensic_reasons`.
=> the interactive overlay DOES work on cold URL incidents.
Not persisted: non-sensitive inputs, images[].
Schema drift across rows: `scan_mode` is one of IMAGE_AND_QUISHING,
MULTIMODAL_IMAGE_OCR_QUISHING, or absent. Normalizer must tolerate all.

## 4. Numeric + timestamp reality
- Via FastAPI `/api/v1/incidents`: scores arrive as JSON **numbers** (78.0).
- `created_at` carries an offset: `2026-11-03T04:07:01.301972+00:00`.
- Keep the defensive `num()` / `parseUtc()` helpers anyway: supabase-js talks to
  PostgREST directly and may differ from the FastAPI proxy.

## 5. THE RUNNING SERVER IS STALE — restart required
Evidence: `/api/v1/benchmark/phase3` -> 404; `/health` omits `vision_capabilities`;
scan responses have empty `applied_rules` and no `latency_breakdown_ms`.
It predates commit 8565e8f (warm Playwright pool).

### Latency measured against the stale build
| scan | time |
|---|---|
| cold, local mock target | 20.2 s |
| warm, local mock target | 13.8 s |
| external https://tniad.mil.id | 38.0 s |
| image poster scan | 17.9 s |

The benchmark report claims P95 ~2.2 s, so these should improve sharply once the
warm pool is live. **Re-measure after restarting the backend.** Until then the
client timeout must stay generous (90 s, not 60 s).

## 6. Existing incident data will NOT populate the map
23 rows: 20 WHATSAPP_BOT / 3 WEB_SANDBOX; 12 CRITICAL / 11 SAFE / 0 SUSPICIOUS.
Every `reporter_unit` is a WA label ("WA Openwa (Denindra)") or a test string -
none match a Kodam coordinate table. The seed script is required, not optional.

## 7. Supabase
`storage_bucket_ok: false` in `/api/v1/supabase/status` is a FALSE ALARM -
the evidence objects serve fine (HTTP 200, image/png, 426 KB). The check
probably needs bucket-list permission. Public read works.
