/**
 * One function per engine endpoint. Everything that returns a scan comes back
 * already normalized, so no component ever sees a raw backend shape.
 */

import {
  SCAN_TIMEOUT_MS,
  getJson,
  postForm,
  postJson,
  type ApiError,
} from './client';
import {
  normalizeImageScan,
  normalizeIncident,
  normalizeUrlScan,
  type IncidentRow,
  type NormalizedScan,
  type SourceSpace,
} from '../normalize';

/* --------------------------------- system --------------------------------- */

export interface HealthResponse {
  status: string;
  service: string;
  platform: string;
  supabase_configured: boolean;
  /** Absent on builds predating the vision-capabilities commit. */
  vision_capabilities?: {
    qr_decoders?: Record<string, boolean>;
    ocr_engines?: Record<string, unknown>;
  };
}

export const getHealth = (signal?: AbortSignal) =>
  getJson<HealthResponse>('/health', { signal, timeoutMs: 8_000 });

export interface SupabaseStatus {
  configured: boolean;
  connected: boolean;
  supabase_url?: string;
  bucket?: string;
  table_scan_incidents_ok?: boolean;
  table_official_portals_ok?: boolean;
  /**
   * Observed false on a working deployment while evidence objects still serve
   * fine — the check needs bucket-list permission. Treat as advisory only.
   */
  storage_bucket_ok?: boolean;
  incidents_count_sample?: number;
  portals_count_sample?: number;
  message?: string;
}

export const getSupabaseStatus = (signal?: AbortSignal) =>
  getJson<SupabaseStatus>('/api/v1/supabase/status', { signal });

/* -------------------------------- incidents ------------------------------- */

interface IncidentsResponse {
  configured: boolean;
  total_returned?: number;
  incidents?: IncidentRow[];
  error?: string;
}

/** History via the engine. The live feed uses Supabase Realtime instead. */
export async function getIncidents(limit = 50, signal?: AbortSignal): Promise<NormalizedScan[]> {
  const res = await getJson<IncidentsResponse>(
    `/api/v1/incidents?limit=${Math.min(100, Math.max(1, limit))}`,
    { signal },
  );
  return (res.incidents ?? []).map(normalizeIncident);
}

/**
 * Look one incident up through the engine.
 *
 * The engine exposes no get-by-id route, so this pulls the recent window and
 * filters client-side. That is fine at this data volume, and it keeps the
 * forensics view usable when the browser has no Supabase credentials — without
 * it, every feed row dead-ends at "not found" in that configuration.
 */
export async function getIncidentById(
  incidentId: string,
  signal?: AbortSignal,
): Promise<NormalizedScan | null> {
  const recent = await getIncidents(100, signal);
  return recent.find((i) => i.incidentId === incidentId) ?? null;
}

/* ----------------------------- reference data ----------------------------- */

export interface ReferencePortal {
  id: string;
  portal_name: string;
  official_domain: string;
  title?: string;
  forms?: number;
  inputs?: number;
  images?: number;
  /** Repo-relative; use referencePortalImage() for a loadable URL. */
  screenshot?: string;
}

export interface ReferencePortalsResponse {
  total_portals: number;
  total_logos: number;
  logos: string[];
  portals: ReferencePortal[];
}

let portalsCache: Promise<ReferencePortalsResponse> | null = null;

/**
 * Module-scoped cache: the forensics view resolves an impersonated target on
 * every visit, and 37 portals do not change within a session.
 */
export function getReferencePortals(signal?: AbortSignal): Promise<ReferencePortalsResponse> {
  if (!portalsCache) {
    portalsCache = getJson<ReferencePortalsResponse>('/api/v1/reference-portals', {
      signal,
    }).catch((err: unknown) => {
      portalsCache = null; // never cache a failure
      throw err;
    });
  }
  return portalsCache;
}

/** The engine serves the portal PNGs at /static/reference/<id>.png. */
export const referencePortalImage = (portalId: string) => `/static/reference/${portalId}.png`;

/** Match an `impersonated_target` string back to its reference portal. */
export function findPortal(
  portals: readonly ReferencePortal[],
  impersonatedTarget: string | null,
): ReferencePortal | null {
  if (!impersonatedTarget) return null;
  const needle = impersonatedTarget.trim().toLowerCase();
  return (
    portals.find((p) => p.portal_name.toLowerCase() === needle) ??
    portals.find((p) => p.official_domain.toLowerCase() === needle) ??
    portals.find(
      (p) =>
        needle.includes(p.official_domain.toLowerCase()) ||
        p.portal_name.toLowerCase().includes(needle),
    ) ??
    null
  );
}

export interface MockTarget {
  filename: string;
  url: string;
}

export const getMockTargets = (signal?: AbortSignal) =>
  getJson<{ total_targets: number; targets: MockTarget[] }>('/api/v1/mock-targets', { signal });

/* ------------------------------ domain guard ------------------------------ */

export interface DomainAssessment {
  host: string;
  is_official: boolean;
  is_ip: boolean;
  is_punycode: boolean;
  is_shortener: boolean;
  is_free_or_tunnel_host: boolean;
  is_high_abuse_tld: boolean;
  scheme: string;
  bait_tokens: string[];
  lookalike_of: string | null;
  lookalike_kind: string | null;
  risk_score: number;
  reasons: string[];
}

/** Fast, no page load — safe to call per keystroke (debounced) and per redirect hop. */
export const checkDomain = (url: string, signal?: AbortSignal) =>
  getJson<DomainAssessment>(`/api/v1/domain/check?url=${encodeURIComponent(url)}`, {
    signal,
    timeoutMs: 8_000,
  });

export interface TriagePreview {
  triage: string;
  target_url: string | null;
  allowed?: boolean;
  refusal_reason?: string | null;
  domain?: DomainAssessment;
}

/** Pre-flight: avoids spending a long scan on a target the engine will refuse. */
export const previewTriage = (text: string, hasImage: boolean, signal?: AbortSignal) =>
  postJson<TriagePreview>('/api/v1/triage/preview', { text, has_image: hasImage }, {
    signal,
    timeoutMs: 8_000,
  });

/* --------------------------------- scans ---------------------------------- */

export interface ScanRequestMeta {
  scanId: string;
  reporterUnit?: string;
  reporterSource?: string;
}

export async function scanUrl(
  url: string,
  meta: ScanRequestMeta,
  signal?: AbortSignal,
): Promise<NormalizedScan> {
  const res = await postJson<Record<string, unknown>>(
    '/api/v1/scan-url',
    {
      url,
      scan_id: meta.scanId,
      reporter_source: meta.reporterSource ?? 'WEB_SANDBOX',
      reporter_unit: meta.reporterUnit ?? 'Simulasi Juri / Satuan Jajaran',
    },
    { signal, timeoutMs: SCAN_TIMEOUT_MS },
  );
  const scan = normalizeUrlScan(res, meta.scanId);
  scan.reporterUnit = meta.reporterUnit ?? null;
  scan.reporterSource = meta.reporterSource ?? 'WEB_SANDBOX';
  return scan;
}

export async function scanImage(
  file: File,
  meta: ScanRequestMeta & { caption?: string; measured?: SourceSpace },
  signal?: AbortSignal,
): Promise<NormalizedScan> {
  const form = new FormData();
  form.append('file', file);
  form.append('scan_id', meta.scanId);
  form.append('reporter_source', meta.reporterSource ?? 'WEB_SANDBOX');
  form.append('reporter_unit', meta.reporterUnit ?? 'Simulasi Juri / Satuan Jajaran');
  if (meta.caption) form.append('caption', meta.caption);

  const res = await postForm<Record<string, unknown>>('/api/v1/scan-image', form, {
    signal,
    timeoutMs: SCAN_TIMEOUT_MS,
  });
  // `measured` carries the uploaded image's own pixel space, which is the
  // coordinate space its bounding boxes use.
  const scan = normalizeImageScan(res, meta.scanId, meta.measured);
  scan.reporterUnit = meta.reporterUnit ?? null;
  scan.reporterSource = meta.reporterSource ?? 'WEB_SANDBOX';
  return scan;
}

/* -------------------------------- benchmark ------------------------------- */

/**
 * Shapes mirror what scripts/benchmark_phase3.py writes to
 * storage/phase3_benchmark_results.json — read from the writer rather than
 * inferred from a sample, so optional fields are known rather than guessed.
 */

export interface BenchmarkMetrics {
  total: number;
  tp: number;
  tn: number;
  fp: number;
  fn: number;
  accuracy: number;
  precision: number;
  recall: number;
  specificity: number;
  f1_score: number;
  balanced_accuracy: number;
  fpr: number;
  fnr: number;
  roc_auc: number;
  pr_auc: number;
}

/** Each entry is a [low, high] percentile pair from a 1000-draw bootstrap. */
export interface BenchmarkCi95 {
  accuracy_ci95?: [number, number];
  precision_ci95?: [number, number];
  recall_ci95?: [number, number];
  f1_ci95?: [number, number];
}

export interface BenchmarkSlice {
  slice_name: string;
  modality: string;
  count: number;
  correct: number;
  accuracy: number;
  mean_sec: number;
  p50_sec: number;
  p95_sec: number;
  sla_pct: number;
}

/** A baseline row is the model name plus the same metric set. */
export type BenchmarkBaseline = { model: string } & Partial<BenchmarkMetrics>;

export interface BenchmarkLatency {
  count: number;
  min: number;
  mean: number;
  p50: number;
  p90: number;
  p95: number;
  max: number;
  sla_pass_pct: number;
}

export interface BenchmarkConcurrency {
  concurrent_requests: number;
  wall_batch_sec: number;
  mean_individual_sec: number;
  max_individual_sec: number;
  all_under_5s_sla: boolean;
}

export interface BenchmarkResponse {
  available: boolean;
  message?: string;
  generated_at?: string;
  sla_target_sec?: number;
  browser_pool_warmup_ms?: number;
  overall_metrics?: BenchmarkMetrics;
  bootstrap_ci_95?: BenchmarkCi95;
  slice_summaries?: BenchmarkSlice[];
  baseline_comparison?: BenchmarkBaseline[];
  playwright_url_latency_sec?: BenchmarkLatency;
  playwright_url_stage_mean_ms?: Record<string, number>;
  concurrency_4x_summary?: BenchmarkConcurrency;
  multimodal_image_latency_sec?: BenchmarkLatency;
  multimodal_image_stage_mean_ms?: Record<string, number>;
  live_wan_results?: unknown[];
}

/**
 * Returns `{available:false}` when storage/phase3_benchmark_results.json has
 * not been generated, and 404s entirely on builds predating the endpoint — the
 * audit page falls back to the committed fixture in both cases.
 */
export async function getBenchmark(signal?: AbortSignal): Promise<BenchmarkResponse> {
  try {
    return await getJson<BenchmarkResponse>('/api/v1/benchmark/phase3', { signal });
  } catch (err) {
    if ((err as ApiError).status === 404) {
      return { available: false, message: 'Endpoint benchmark tidak tersedia pada build mesin ini.' };
    }
    throw err;
  }
}
