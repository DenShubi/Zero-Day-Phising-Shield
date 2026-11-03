/**
 * Typed fetch wrapper for the VisiKartika engine.
 *
 * The browser calls FastAPI DIRECTLY — never through a Next route handler.
 * Scans are synchronous and can take tens of seconds, while Vercel serverless
 * functions cap at 10s, so any server-side proxy would pass locally and fail in
 * production. There is no auth and no credential to hide, so this costs nothing.
 *
 * The base URL is resolved at RUNTIME, not baked at build time: a Cloudflare
 * quick tunnel hands out a new hostname on every restart, and rebuilding the
 * frontend to chase it mid-demo is not viable.
 */

const STORAGE_KEY = 'vk.backendUrl';
const DEFAULT_BASE = 'http://localhost:8000';

/** Reads above the SLA deliberately — see the latency note on SCAN_TIMEOUT_MS. */
export const READ_TIMEOUT_MS = 15_000;

/**
 * Measured 2026-11-03 against the pre-warm-pool build: 20s cold local, 38s for
 * an external site. The engine's warm pool should bring this far down, but the
 * timeout stays generous until that is re-measured — a timeout mid-demo is
 * worse than a long spinner, and the UI shows staged progress meanwhile.
 */
export const SCAN_TIMEOUT_MS = 90_000;

/**
 * Fields are declared explicitly rather than as TypeScript parameter
 * properties, so this module also runs under Node's strip-only TypeScript
 * mode — which is what the test runner and the verification scripts use.
 */
export class ApiError extends Error {
  readonly status: number;
  /** FastAPI's `{"detail": "..."}` string, shown verbatim to the operator. */
  readonly detail: string;
  readonly url: string;

  constructor(status: number, detail: string, url: string) {
    super(detail);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
    this.url = url;
  }
}

/** Thrown when a request is aborted by timeout or by the caller. */
export class ApiAbortError extends Error {
  readonly url: string;
  readonly timedOut: boolean;

  constructor(url: string, timedOut: boolean) {
    super(timedOut ? 'Permintaan melebihi batas waktu' : 'Permintaan dibatalkan');
    this.name = 'ApiAbortError';
    this.url = url;
    this.timedOut = timedOut;
  }
}

function normalizeBase(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

/**
 * Resolution order: operator override, then build-time env, then localhost.
 * Must only be called in the browser — `localStorage` does not exist during the
 * prerender pass, and reading it at module scope would break `next build`.
 */
export function getBackendUrl(): string {
  if (typeof window !== 'undefined') {
    try {
      const override = window.localStorage.getItem(STORAGE_KEY);
      if (override && override.trim() !== '') return normalizeBase(override);
    } catch {
      // Private mode or blocked storage: fall through to the env default.
    }
  }
  return normalizeBase(process.env.NEXT_PUBLIC_BACKEND_URL || DEFAULT_BASE);
}

export function setBackendUrl(url: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (url === null || url.trim() === '') window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, normalizeBase(url));
  } catch {
    // Non-fatal: the in-memory default still works for this session.
  }
}

/** Absolute URL for an engine-relative path, e.g. a /static evidence image. */
export function engineUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${getBackendUrl()}/${path.replace(/^\/+/, '')}`;
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: BodyInit | null;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Caller-owned signal, so a component can cancel on unmount or re-submit. */
  signal?: AbortSignal;
}

async function extractDetail(res: Response): Promise<string> {
  try {
    const text = await res.text();
    if (!text) return `${res.status} ${res.statusText}`;
    try {
      const parsed = JSON.parse(text) as { detail?: unknown };
      if (typeof parsed.detail === 'string') return parsed.detail;
      // 422 returns detail as an array of validation objects.
      if (Array.isArray(parsed.detail)) return JSON.stringify(parsed.detail);
    } catch {
      // Not JSON — a proxy or tunnel error page. Keep it short.
    }
    return text.slice(0, 300);
  } catch {
    return `${res.status} ${res.statusText}`;
  }
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body = null, headers = {}, timeoutMs = READ_TIMEOUT_MS, signal } = options;
  const url = engineUrl(path);

  // Compose our timeout with the caller's cancellation.
  const timer = new AbortController();
  const timeoutId = setTimeout(() => timer.abort(), timeoutMs);
  const onCallerAbort = () => timer.abort();
  signal?.addEventListener('abort', onCallerAbort, { once: true });

  try {
    const res = await fetch(url, { method, body, headers, signal: timer.signal });
    if (!res.ok) throw new ApiError(res.status, await extractDetail(res), url);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiAbortError(url, !signal?.aborted);
    }
    // Most often CORS, mixed content, a dead tunnel, or the engine being down.
    throw new ApiError(
      0,
      `Tidak dapat menghubungi mesin di ${getBackendUrl()}. Periksa koneksi, CORS_ORIGINS, atau alamat backend.`,
      url,
    );
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', onCallerAbort);
  }
}

export function getJson<T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) {
  return request<T>(path, { ...opts, method: 'GET' });
}

export function postJson<T>(
  path: string,
  payload: unknown,
  opts?: Omit<RequestOptions, 'method' | 'body' | 'headers'>,
) {
  return request<T>(path, {
    ...opts,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function postForm<T>(
  path: string,
  form: FormData,
  opts?: Omit<RequestOptions, 'method' | 'body' | 'headers'>,
) {
  // No explicit Content-Type: the browser must set the multipart boundary.
  return request<T>(path, { ...opts, method: 'POST', body: form });
}
