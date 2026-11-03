/**
 * The single entry point for every shape the engine, PostgREST and Supabase
 * Realtime can hand us. Components consume `NormalizedScan` and nothing else.
 *
 * Every rule below was verified against live responses on 2026-11-03; see
 * docs/FRONTEND_DAY1_FINDINGS.md. The quirks absorbed here:
 *
 *  1. Shape asymmetry. A URL scan nests dom/domain scores and forensic reasons
 *     under `risk_analysis`; an image scan puts all three at the top level.
 *  2. Numeric transport. The FastAPI proxy returns scores as JSON numbers;
 *     supabase-js talks to PostgREST directly and may return NUMERIC as strings.
 *     `num()` accepts both — "87.50" > 70 is false in JS, so this is load-bearing.
 *  3. applied_rules lives at dom_findings.risk_fusion.applied_rules on a stored
 *     row, but at the top level on a live scan response.
 *  4. risk_fusion.weighted_score persists the PRE-override score, so the
 *     explainability delta works on cold rows without recomputation.
 *  5. Bounding-box coordinate spaces differ: URL scans are 1280x720
 *     (full_page=False, app/sandbox/browser.py:494), image scans are the source
 *     image's own pixel space (proven by a rescale test). Never assume 16:9.
 *  6. Schema drift: older rows lack latency_breakdown_ms, content_category and
 *     scan_mode. Everything optional is treated as optional.
 */

import { RISK_WEIGHTS, bandOf, type Verdict } from './verdict';

export type Numeric = number | string | null | undefined;
export type ScanKind = 'URL' | 'IMAGE';

/* ------------------------------- primitives ------------------------------- */

/** Accepts the number OR string form of a NUMERIC column. */
export function num(value: Numeric, fallback = 0): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value !== 'string') return fallback;
  const t = value.trim();
  if (t === '') return fallback;
  // An id-ID formatted "88,50" would otherwise parse to NaN.
  const n = Number(t.includes(',') && !t.includes('.') ? t.replace(',', '.') : t);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * For score components that may legitimately not apply — a poster scan with no
 * URL has no domain to assess, and rendering 0 there would read as "clean".
 */
export function numOrNull(value: Numeric): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = num(value, Number.NaN);
  return Number.isFinite(n) ? n : null;
}

export const clampScore = (v: Numeric): number => Math.min(100, Math.max(0, num(v, 0)));

const VERDICTS = new Set(['SAFE', 'SUSPICIOUS', 'CRITICAL_PHISHING']);

/** Always prefer the engine's own verdict; the band is a last-resort fallback. */
export function asVerdict(raw: unknown, total: number): Verdict {
  if (typeof raw === 'string') {
    const up = raw.trim().toUpperCase().replace(/[\s-]+/g, '_');
    if (VERDICTS.has(up)) return up as Verdict;
  }
  return bandOf(total);
}

const HAS_TZ = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Postgres `timestamp without time zone` arrives with no offset, and
 * `new Date(s)` would then read it as browser-local — shifting the whole feed
 * by 7 hours in WIB. Live rows do carry "+00:00", but older ones may not.
 */
export function parseUtc(raw: string | null | undefined): { iso: string; ms: number } {
  const now = () => {
    const ms = Date.now();
    return { iso: new Date(ms).toISOString(), ms };
  };
  if (!raw) return now();
  const s = raw.trim();
  const ms = Date.parse(HAS_TZ.test(s) ? s : `${s.replace(' ', 'T')}Z`);
  if (!Number.isFinite(ms)) return now();
  return { iso: new Date(ms).toISOString(), ms };
}

/** Hostname in ASCII (A-label) form; RPZ and dnsmasq cannot take U-labels. */
export function hostOf(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (s === '' || s.startsWith('[IMAGE:')) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `http://${s}`);
    const h = u.hostname.toLowerCase().replace(/\.$/, '');
    return h === '' ? null : h;
  } catch {
    return null;
  }
}

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const rec = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/* --------------------------------- model ---------------------------------- */

export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The pixel space a bbox is expressed in. Required by BBoxOverlay — there is no
 * safe default, because URL and image scans genuinely differ.
 */
export interface SourceSpace {
  width: number;
  height: number;
}

/** URL captures are a fixed viewport: app/sandbox/browser.py:494. */
export const URL_CAPTURE_SPACE: SourceSpace = { width: 1280, height: 720 };

export interface ScoreBreakdown {
  visual: number;
  dom: number;
  /** null when there is no URL anywhere in the artifact, so no domain to assess. */
  domain: number | null;
  total: number;
  /** Pre-override weighted sum; differs from `total` whenever a rule fired. */
  weightedBase: number;
  /** total - weightedBase. Non-zero means an override floor/cap applied. */
  ruleDelta: number;
  /** True when weightedBase came from the engine rather than being recomputed. */
  baseFromEngine: boolean;
}

export interface DetectedLogo {
  brandName: string;
  confidence: number;
  bbox: BBox | null;
}

export interface UrlScanExtras {
  redirectChain: string[];
  statusCode: number | null;
  pageTitle: string | null;
  forms: {
    index: number;
    action: string | null;
    resolvedAction: string | null;
    method: string | null;
    isCrossOrigin: boolean;
    bbox: BBox | null;
  }[];
  inputs: {
    tag: string;
    type: string | null;
    name: string | null;
    id: string | null;
    placeholder: string | null;
    required: boolean;
    isSensitiveCredential: boolean;
    bbox: BBox | null;
  }[];
  militaryKeywords: string[];
  externalDomains: string[];
  hasCredentialHarvesting: boolean;
  isOfficialMilDomain: boolean;
}

export interface ImageScanExtras {
  layoutType: string | null;
  qrCodes: { payload: string; bbox: BBox | null; decoder: string | null }[];
  extractedUrls: string[];
  ocrTextSnippet: string | null;
  visualInputBoxesCount: number;
  sourceImage: string | null;
}

export interface NormalizedScan {
  kind: ScanKind;
  /** Client-generated for live scans; the row id for stored incidents. */
  scanId: string;
  incidentId: string | null;
  ticket: string | null;
  submittedUrl: string | null;
  finalUrl: string | null;
  host: string | null;
  verdict: Verdict;
  scores: ScoreBreakdown;
  /** Open string, never a union: the engine emits values absent from its own model docs. */
  contentCategory: string | null;
  impersonatedTarget: string | null;
  screenshotUrl: string | null;
  annotatedUrl: string | null;
  /** null for image scans until the <img> loads and reports naturalWidth/Height. */
  sourceSpace: SourceSpace | null;
  detectedLogos: DetectedLogo[];
  forensicReasons: string[];
  appliedRules: string[];
  latencyMs: Record<string, number>;
  executionSec: number | null;
  synced: boolean;
  /** Rebuilt from a stored row: some panels have reduced data. */
  degraded: boolean;
  reporterSource: string | null;
  reporterUnit: string | null;
  createdAtIso: string;
  createdAtMs: number;
  url?: UrlScanExtras;
  image?: ImageScanExtras;
}

/* ------------------------------- conversion ------------------------------- */

function bbox(raw: unknown): BBox | null {
  const r = rec(raw);
  if (Object.keys(r).length === 0) return null;
  const b = {
    x: num(r.x as Numeric),
    y: num(r.y as Numeric),
    width: num(r.width as Numeric),
    height: num(r.height as Numeric),
  };
  return b.width > 0 && b.height > 0 ? b : null;
}

function logos(raw: unknown): DetectedLogo[] {
  return arr<Record<string, unknown>>(raw).map((l) => ({
    brandName: str(l.brand_name) ?? 'TIDAK DIKENAL',
    confidence: num(l.confidence as Numeric),
    bbox: bbox(l.bbox),
  }));
}

function latency(raw: unknown): Record<string, number> {
  return Object.fromEntries(
    Object.entries(rec(raw)).map(([k, v]) => [k, num(v as Numeric)]),
  );
}

/**
 * `weightedBase` prefers the engine's persisted value. Recomputing it is only a
 * fallback, and is wrong whenever the domain component is not applicable.
 */
function breakdown(
  visual: Numeric,
  dom: Numeric,
  domain: Numeric,
  total: Numeric,
  engineWeighted?: Numeric,
): ScoreBreakdown {
  const v = clampScore(visual);
  const d = clampScore(dom);
  const dt = numOrNull(domain) === null ? null : clampScore(domain);
  const tot = clampScore(total);

  const fromEngine = numOrNull(engineWeighted);
  const base =
    fromEngine ??
    Math.round(
      (RISK_WEIGHTS.visual * v + RISK_WEIGHTS.dom * d + RISK_WEIGHTS.domain * (dt ?? 0)) * 100,
    ) / 100;

  return {
    visual: v,
    dom: d,
    domain: dt,
    total: tot,
    weightedBase: Math.round(base * 100) / 100,
    ruleDelta: Math.round((tot - base) * 100) / 100,
    baseFromEngine: fromEngine !== null,
  };
}

/** SOC ticket format from app/wa_triage.py:_ticket_line. */
export function ticketFor(incidentId: string | null): string | null {
  if (!incidentId) return null;
  const seg = incidentId.split('-')[0];
  return seg ? `#VK-${seg.toUpperCase()}` : null;
}

/* ----------------------------- live responses ----------------------------- */

export function normalizeUrlScan(
  res: Record<string, unknown>,
  scanId: string,
): NormalizedScan {
  // Phase2ScanResponse nests dom/domain/forensics under risk_analysis.
  const ra = rec(res.risk_analysis);
  const incidentId = str(res.supabase_incident_id);
  const finalUrl = str(res.final_url);
  const initialUrl = str(res.initial_url);
  const { iso, ms } = parseUtc(new Date().toISOString());

  return {
    kind: 'URL',
    scanId,
    incidentId,
    ticket: ticketFor(incidentId),
    submittedUrl: initialUrl,
    finalUrl,
    host: hostOf(finalUrl ?? initialUrl),
    verdict: asVerdict(res.verdict, clampScore(res.total_risk_score as Numeric)),
    scores: breakdown(
      res.visual_similarity_score as Numeric,
      ra.dom_anomaly_score as Numeric,
      ra.domain_telemetry_score as Numeric,
      res.total_risk_score as Numeric,
    ),
    contentCategory: str(res.content_category),
    impersonatedTarget: str(res.impersonated_target),
    screenshotUrl: str(res.captured_screenshot_url),
    annotatedUrl: str(res.annotated_bbox_url),
    sourceSpace: URL_CAPTURE_SPACE,
    detectedLogos: logos(res.detected_logos),
    forensicReasons: arr<string>(ra.forensic_reasons),
    appliedRules: arr<string>(res.applied_rules),
    latencyMs: latency(res.latency_breakdown_ms),
    executionSec: numOrNull(res.execution_time_sec as Numeric),
    synced: res.supabase_synced === true,
    degraded: false,
    reporterSource: null,
    reporterUnit: null,
    createdAtIso: iso,
    createdAtMs: ms,
    url: {
      redirectChain: arr<string>(res.redirect_chain),
      statusCode: numOrNull(res.status_code as Numeric),
      pageTitle: str(res.page_title),
      forms: arr<Record<string, unknown>>(res.forms).map((f, i) => ({
        index: numOrNull(f.form_index as Numeric) ?? i,
        action: str(f.action),
        resolvedAction: str(f.resolved_action),
        method: str(f.method),
        isCrossOrigin: f.is_cross_origin === true,
        bbox: bbox(f.bbox),
      })),
      inputs: arr<Record<string, unknown>>(res.inputs).map((p) => ({
        tag: str(p.tag) ?? 'input',
        type: str(p.type),
        name: str(p.name),
        id: str(p.id),
        placeholder: str(p.placeholder),
        required: p.required === true,
        isSensitiveCredential: p.is_sensitive_credential === true,
        bbox: bbox(p.bbox),
      })),
      militaryKeywords: arr<string>(res.detected_military_keywords),
      externalDomains: arr<string>(res.external_domains_contacted),
      hasCredentialHarvesting: ra.has_credential_harvesting === true,
      isOfficialMilDomain: ra.is_official_mil_domain === true,
    },
  };
}

export function normalizeImageScan(
  res: Record<string, unknown>,
  scanId: string,
  measured?: SourceSpace,
): NormalizedScan {
  // ImageScanResponse puts dom/domain/forensics at the TOP level.
  const incidentId = str(res.supabase_incident_id);
  const extracted = arr<string>(res.extracted_urls);
  const layout = str(res.layout_type);
  const sourceImage = str(res.source_image);
  const { iso, ms } = parseUtc(new Date().toISOString());

  // With no URL in the artifact there is no domain to assess; null, not zero.
  const domainScore: Numeric =
    extracted.length === 0 && !num(res.domain_telemetry_score as Numeric)
      ? null
      : (res.domain_telemetry_score as Numeric);

  return {
    kind: 'IMAGE',
    scanId,
    incidentId,
    ticket: ticketFor(incidentId),
    submittedUrl: `[IMAGE:${layout ?? 'GENERAL_IMAGE'}] ${sourceImage ?? 'unggahan'}`,
    finalUrl: extracted[0] ?? null,
    host: hostOf(extracted[0] ?? null),
    verdict: asVerdict(res.verdict, clampScore(res.total_risk_score as Numeric)),
    scores: breakdown(
      res.visual_similarity_score as Numeric,
      res.dom_anomaly_score as Numeric,
      domainScore,
      res.total_risk_score as Numeric,
    ),
    contentCategory: str(res.content_category),
    impersonatedTarget: str(res.impersonated_target),
    screenshotUrl: str(res.captured_screenshot_url) ?? sourceImage,
    annotatedUrl: str(res.annotated_bbox_url),
    // Unknown until the image loads: bboxes are in the SOURCE image's pixel
    // space, which is arbitrary. Verified by rescale test on 2026-11-03.
    sourceSpace: measured ?? null,
    detectedLogos: logos(res.detected_logos),
    forensicReasons: arr<string>(res.forensic_reasons),
    appliedRules: arr<string>(res.applied_rules),
    latencyMs: latency(res.latency_breakdown_ms),
    executionSec: numOrNull(res.execution_time_sec as Numeric),
    synced: res.supabase_synced === true,
    degraded: false,
    reporterSource: null,
    reporterUnit: null,
    createdAtIso: iso,
    createdAtMs: ms,
    image: {
      layoutType: layout,
      qrCodes: arr<Record<string, unknown>>(res.decoded_qr_codes).map((q) => ({
        payload: str(q.payload) ?? '',
        bbox: bbox(q.bbox),
        decoder: str(q.decoder),
      })),
      extractedUrls: extracted,
      ocrTextSnippet: str(res.ocr_text_snippet),
      visualInputBoxesCount: num(res.visual_input_boxes_count as Numeric),
      sourceImage,
    },
  };
}

/* --------------------------- stored incident row -------------------------- */

export interface IncidentRow {
  id: string;
  submitted_url: string | null;
  reporter_source: string | null;
  reporter_unit: string | null;
  visual_similarity_score: Numeric;
  dom_anomaly_score: Numeric;
  domain_telemetry_score: Numeric;
  total_risk_score: Numeric;
  verdict: string | null;
  impersonated_target: string | null;
  captured_screenshot_url: string | null;
  annotated_bbox_url: string | null;
  detected_logos: unknown;
  dom_findings: unknown;
  created_at: string | null;
}

/** An image scan with no URL stores a synthetic label instead of one. */
const SYNTHETIC_URL = /^\[IMAGE:([^\]]*)\]\s*(.*)$/;

/**
 * Rebuild a scan from a persisted row. Marked `degraded` because some fields are
 * not persisted — but less is lost than one might expect: forms[].bbox and
 * sensitive_inputs[].bbox ARE stored, so the interactive overlay still works for
 * URL incidents. Missing: non-sensitive inputs, images[], and (on older rows)
 * latency_breakdown_ms.
 */
export function normalizeIncident(row: IncidentRow): NormalizedScan {
  const f = rec(row.dom_findings);
  const fusion = rec(f.risk_fusion);
  const synthetic = SYNTHETIC_URL.exec(row.submitted_url ?? '');
  const layout = synthetic?.[1]?.trim() || str(f.layout_type);
  const extracted = arr<string>(f.extracted_urls);

  // A row is an image scan if it carries the synthetic label or an image-only
  // scan_mode. Older rows have neither, so fall back to the absence of forms.
  const scanMode = str(f.scan_mode) ?? '';
  const isImage =
    synthetic !== null || scanMode.includes('IMAGE') || (!('forms' in f) && Boolean(layout));

  const realUrl = synthetic ? null : row.submitted_url;
  const finalUrl = str(f.final_url) ?? realUrl ?? extracted[0] ?? null;
  const { iso, ms } = parseUtc(row.created_at);

  const base: NormalizedScan = {
    kind: isImage ? 'IMAGE' : 'URL',
    scanId: row.id,
    incidentId: row.id,
    ticket: ticketFor(row.id),
    submittedUrl: row.submitted_url,
    finalUrl,
    host: hostOf(finalUrl),
    verdict: asVerdict(row.verdict, clampScore(row.total_risk_score)),
    scores: breakdown(
      row.visual_similarity_score,
      row.dom_anomaly_score,
      isImage && extracted.length === 0 ? null : row.domain_telemetry_score,
      row.total_risk_score,
      // Persisted pre-override base — see risk_fusion in app/scanner_service.py.
      fusion.weighted_score as Numeric,
    ),
    contentCategory: str(f.content_category),
    impersonatedTarget: row.impersonated_target,
    screenshotUrl: row.captured_screenshot_url,
    annotatedUrl: row.annotated_bbox_url,
    sourceSpace: isImage ? null : URL_CAPTURE_SPACE,
    detectedLogos: logos(row.detected_logos),
    forensicReasons: arr<string>(f.forensic_reasons),
    // On a stored row applied_rules is nested inside risk_fusion.
    appliedRules: arr<string>(fusion.applied_rules),
    latencyMs: latency(f.latency_breakdown_ms),
    executionSec: null,
    synced: true,
    degraded: true,
    reporterSource: row.reporter_source,
    reporterUnit: row.reporter_unit,
    createdAtIso: iso,
    createdAtMs: ms,
  };

  if (isImage) {
    base.image = {
      layoutType: layout,
      qrCodes: arr<Record<string, unknown>>(f.decoded_qr_codes).map((q) => ({
        payload: str(q.payload) ?? '',
        bbox: bbox(q.bbox),
        decoder: str(q.decoder),
      })),
      extractedUrls: extracted,
      ocrTextSnippet: str(f.ocr_text_snippet),
      visualInputBoxesCount: num(f.visual_input_boxes_count as Numeric),
      sourceImage: str(f.source_image) ?? synthetic?.[2] ?? null,
    };
  } else {
    base.url = {
      redirectChain: arr<string>(f.redirect_chain),
      statusCode: numOrNull(f.status_code as Numeric),
      pageTitle: str(f.page_title),
      forms: arr<Record<string, unknown>>(f.forms).map((x, i) => ({
        index: numOrNull(x.form_index as Numeric) ?? i,
        action: str(x.action),
        resolvedAction: str(x.resolved_action),
        method: str(x.method),
        isCrossOrigin: x.is_cross_origin === true,
        bbox: bbox(x.bbox),
      })),
      // Only credential-bearing inputs are persisted, under a different key.
      inputs: arr<Record<string, unknown>>(f.sensitive_inputs).map((p) => ({
        tag: str(p.tag) ?? 'input',
        type: str(p.type),
        name: str(p.name),
        id: str(p.id),
        placeholder: str(p.placeholder),
        required: p.required === true,
        isSensitiveCredential: p.is_sensitive_credential !== false,
        bbox: bbox(p.bbox),
      })),
      militaryKeywords: arr<string>(f.detected_military_keywords),
      externalDomains: arr<string>(f.external_domains_contacted),
      hasCredentialHarvesting: arr<unknown>(f.sensitive_inputs).length > 0,
      isOfficialMilDomain: clampScore(row.total_risk_score) === 0,
    };
  }

  return base;
}
