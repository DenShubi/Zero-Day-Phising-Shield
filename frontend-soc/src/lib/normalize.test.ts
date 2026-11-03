/**
 * Tests for the normalizer, run against REAL captured responses in src/fixtures
 * rather than hand-written objects — the shape quirks being guarded here were
 * discovered from live data, and a synthetic fixture would drift from it.
 *
 * Run with Node's built-in runner and type stripping (no test framework):
 *   node --test --experimental-strip-types src/lib/normalize.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  URL_CAPTURE_SPACE,
  asVerdict,
  hostOf,
  normalizeIncident,
  normalizeImageScan,
  normalizeUrlScan,
  num,
  numOrNull,
  parseUtc,
  ticketFor,
  type IncidentRow,
} from './normalize';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(here, '..', 'fixtures', `${name}.json`), 'utf8'));

describe('num', () => {
  it('accepts the number form the FastAPI proxy returns', () => {
    assert.equal(num(78.0), 78);
  });

  it('accepts the string form PostgREST can return for NUMERIC', () => {
    // The bug this prevents: "87.50" > 70 is false in JS.
    assert.equal(num('87.50'), 87.5);
    assert.ok(num('87.50') > 70);
  });

  it('handles an id-ID decimal comma', () => {
    assert.equal(num('88,50'), 88.5);
  });

  it('falls back rather than producing NaN', () => {
    assert.equal(num(undefined), 0);
    assert.equal(num('tidak-ada'), 0);
    assert.equal(num(Number.NaN), 0);
  });
});

describe('numOrNull', () => {
  it('distinguishes a real zero from an absent value', () => {
    // A 0 domain score means "assessed, clean"; null means "no URL to assess".
    assert.equal(numOrNull(0), 0);
    assert.equal(numOrNull(null), null);
    assert.equal(numOrNull(''), null);
  });
});

describe('parseUtc', () => {
  it('respects an explicit offset', () => {
    const { iso } = parseUtc('2026-11-03T04:07:01.301972+00:00');
    assert.equal(iso, '2026-11-03T04:07:01.301Z');
  });

  it('treats a naive timestamp as UTC, not browser-local', () => {
    // Parsing this as local time would shift the whole feed by 7h in WIB.
    assert.equal(parseUtc('2026-11-03 04:07:01').iso, '2026-11-03T04:07:01.000Z');
  });
});

describe('hostOf', () => {
  it('extracts and lowercases a hostname', () => {
    assert.equal(hostOf('https://Evil.Example.COM/a?b=1'), 'evil.example.com');
  });

  it('refuses the synthetic image label', () => {
    assert.equal(hostOf('[IMAGE:POSTER_FLYER] poster.png'), null);
  });

  it('returns null for unparseable input', () => {
    assert.equal(hostOf(''), null);
    assert.equal(hostOf(null), null);
  });
});

describe('asVerdict', () => {
  it('trusts the engine over the score', () => {
    // An override floor can raise the verdict above what the score implies.
    assert.equal(asVerdict('SAFE', 95), 'SAFE');
  });

  it('falls back to the band only when the verdict is unusable', () => {
    assert.equal(asVerdict(null, 85), 'CRITICAL_PHISHING');
    assert.equal(asVerdict(undefined, 50), 'SUSPICIOUS');
    assert.equal(asVerdict('', 10), 'SAFE');
  });
});

describe('ticketFor', () => {
  it('matches the engine format in app/wa_triage.py', () => {
    assert.equal(ticketFor('6dec7ab9-54de-49b9-bc93-f4f9b405ba16'), '#VK-6DEC7AB9');
    assert.equal(ticketFor(null), null);
  });
});

describe('normalizeUrlScan', () => {
  const raw = fixture('scan-url-critical');
  const scan = normalizeUrlScan(raw, 'test-scan-1');

  it('lifts the nested risk_analysis sub-scores to the top level', () => {
    assert.equal(scan.scores.dom, raw.risk_analysis.dom_anomaly_score);
    assert.equal(scan.scores.domain, raw.risk_analysis.domain_telemetry_score);
  });

  it('reads forensic reasons from risk_analysis, not the top level', () => {
    assert.deepEqual(scan.forensicReasons, raw.risk_analysis.forensic_reasons);
  });

  it('reports the fixed viewport capture space', () => {
    // app/sandbox/browser.py:494 captures with full_page=False.
    assert.deepEqual(scan.sourceSpace, URL_CAPTURE_SPACE);
  });

  it('keeps the engine verdict', () => {
    assert.equal(scan.verdict, 'CRITICAL_PHISHING');
  });

  it('carries form and input bounding boxes', () => {
    assert.ok(scan.url);
    const crossOrigin = scan.url.forms.filter((f) => f.isCrossOrigin);
    assert.ok(crossOrigin.length > 0, 'fixture should contain a cross-origin form');
    assert.ok(crossOrigin[0].bbox, 'cross-origin form should carry a bbox');
  });

  it('is not marked degraded', () => {
    assert.equal(scan.degraded, false);
  });
});

describe('normalizeUrlScan (official portal)', () => {
  const scan = normalizeUrlScan(fixture('scan-url-safe'), 'test-scan-2');

  it('represents the whitelist short-circuit', () => {
    assert.equal(scan.verdict, 'SAFE');
    assert.equal(scan.scores.total, 0);
    assert.equal(scan.url?.isOfficialMilDomain, true);
  });
});

describe('normalizeImageScan', () => {
  const raw = fixture('scan-image-quishing');
  const scan = normalizeImageScan(raw, 'test-scan-3', { width: 1280, height: 720 });

  it('reads top-level sub-scores rather than a nested object', () => {
    assert.equal(scan.scores.dom, raw.dom_anomaly_score);
    assert.equal(scan.scores.domain, raw.domain_telemetry_score);
  });

  it('decodes the quishing QR payload', () => {
    assert.ok(scan.image);
    assert.equal(scan.image.qrCodes.length, 1);
    assert.match(scan.image.qrCodes[0].payload, /^https?:\/\//);
    assert.ok(scan.image.qrCodes[0].bbox);
  });

  it('builds the synthetic submitted_url label', () => {
    assert.match(scan.submittedUrl ?? '', /^\[IMAGE:/);
  });

  it('uses the measured source space, never a hardcoded viewport', () => {
    assert.deepEqual(scan.sourceSpace, { width: 1280, height: 720 });
  });

  it('leaves the source space null when it has not been measured', () => {
    const unmeasured = normalizeImageScan(raw, 'test-scan-4');
    assert.equal(unmeasured.sourceSpace, null);
  });
});

describe('image bbox coordinate space', () => {
  // Verified empirically 2026-11-03: the same poster scanned at two sizes
  // produces boxes that scale with the SOURCE image, not a fixed viewport.
  // This is why BBoxOverlay requires an explicit sourceSpace.
  const big = normalizeImageScan(fixture('scan-image-quishing'), 'a', {
    width: 1280,
    height: 720,
  });
  const small = normalizeImageScan(fixture('scan-image-800x450'), 'b', {
    width: 800,
    height: 450,
  });

  it('scales bounding boxes with the source dimensions', () => {
    const b = big.image?.qrCodes[0]?.bbox;
    const s = small.image?.qrCodes[0]?.bbox;
    assert.ok(b && s, 'both fixtures should decode a QR code');

    const ratio = 800 / 1280;
    // Allow a couple of pixels for the detector's own rounding.
    assert.ok(Math.abs(s.x - b.x * ratio) <= 2, `x: ${s.x} vs ${b.x * ratio}`);
    assert.ok(Math.abs(s.width - b.width * ratio) <= 2, `w: ${s.width} vs ${b.width * ratio}`);
  });

  it('places boxes at the same relative position in both source spaces', () => {
    const b = big.image!.qrCodes[0].bbox!;
    const s = small.image!.qrCodes[0].bbox!;
    // This is exactly what the overlay's percentage positioning relies on.
    assert.ok(Math.abs(b.x / 1280 - s.x / 800) < 0.01);
    assert.ok(Math.abs(b.y / 720 - s.y / 450) < 0.01);
  });
});

describe('normalizeIncident', () => {
  const rows = fixture('incidents').incidents as IncidentRow[];

  it('has fixture rows to work with', () => {
    assert.ok(rows.length > 0);
  });

  it('normalizes every stored row without throwing', () => {
    for (const row of rows) {
      const inc = normalizeIncident(row);
      assert.ok(inc.scanId);
      assert.ok(['SAFE', 'SUSPICIOUS', 'CRITICAL_PHISHING'].includes(inc.verdict));
      assert.equal(typeof inc.scores.total, 'number');
      assert.ok(Number.isFinite(inc.createdAtMs));
      assert.equal(inc.degraded, true);
    }
  });

  it('reads applied_rules from inside risk_fusion', () => {
    // The trap: they are NOT at dom_findings.applied_rules.
    const withRules = rows.find((r) => {
      const f = r.dom_findings as Record<string, unknown> | null;
      const fusion = (f?.risk_fusion ?? {}) as Record<string, unknown>;
      return Array.isArray(fusion.applied_rules) && fusion.applied_rules.length > 0;
    });
    assert.ok(withRules, 'fixture should contain a row with applied rules');
    assert.ok(normalizeIncident(withRules).appliedRules.length > 0);
  });

  it('prefers the persisted pre-override weighted score', () => {
    const withFusion = rows.find((r) => {
      const f = r.dom_findings as Record<string, unknown> | null;
      const fusion = (f?.risk_fusion ?? {}) as Record<string, unknown>;
      return typeof fusion.weighted_score === 'number';
    });
    assert.ok(withFusion, 'fixture should contain a row with risk_fusion');

    const inc = normalizeIncident(withFusion);
    assert.equal(inc.scores.baseFromEngine, true);
    const fusion = (withFusion.dom_findings as Record<string, unknown>).risk_fusion as Record<
      string,
      unknown
    >;
    assert.equal(inc.scores.weightedBase, fusion.weighted_score);
  });

  it('detects image rows from the synthetic label', () => {
    const imageRow = rows.find((r) => String(r.submitted_url).startsWith('[IMAGE:'));
    if (!imageRow) return; // not all captures contain one
    const inc = normalizeIncident(imageRow);
    assert.equal(inc.kind, 'IMAGE');
    assert.ok(inc.image);
    assert.equal(inc.host, null, 'a synthetic label is not a URL');
  });

  it('recovers persisted bboxes for URL rows', () => {
    // Cold forensics is less degraded than it looks: forms[].bbox and
    // sensitive_inputs[].bbox ARE stored, so the overlay still works.
    const urlRow = rows.find((r) => {
      const f = r.dom_findings as Record<string, unknown> | null;
      return Array.isArray(f?.forms) && f.forms.length > 0;
    });
    if (!urlRow) return;
    const inc = normalizeIncident(urlRow);
    assert.equal(inc.kind, 'URL');
    assert.ok(inc.url);
    assert.ok(inc.url.forms.some((f) => f.bbox !== null), 'a stored form should keep its bbox');
  });

  it('tolerates rows with no latency breakdown', () => {
    // Older rows predate latency_breakdown_ms entirely.
    for (const row of rows) {
      assert.equal(typeof normalizeIncident(row).latencyMs, 'object');
    }
  });
});
