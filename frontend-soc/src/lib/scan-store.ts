'use client';

/**
 * Hot cache for scan results, so a fresh scan can hand its full payload to the
 * forensics view without a round trip.
 *
 * sessionStorage rather than a state library, deliberately:
 *
 *  - A store would not survive a refresh, so a storage layer is needed anyway;
 *    keeping both would mean two sources of truth.
 *  - sessionStorage survives F5 in the same tab, so a reload keeps the full
 *    interactive view, while a copied link or a new tab falls through to
 *    Supabase and renders the degraded view. That asymmetry is exactly right:
 *    the rich data genuinely only exists in the tab that ran the scan.
 *
 * A stored row has no scan_id column, so `supabase_incident_id` is the only
 * durable key. Entries are aliased under both ids, and the route prefers the
 * incident id when one exists.
 */

import type { NormalizedScan } from './normalize';

const PREFIX = 'vk:scan:';
const INDEX_KEY = 'vk:scan:index';
const MAX_ENTRIES = 20;

function readIndex(): string[] {
  try {
    const raw = sessionStorage.getItem(INDEX_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function writeIndex(keys: readonly string[]): void {
  try {
    sessionStorage.setItem(INDEX_KEY, JSON.stringify(keys));
  } catch {
    // Non-fatal: the cache degrades to whatever already fits.
  }
}

/** Drop the oldest entries until the newest MAX_ENTRIES remain. */
function prune(keep: readonly string[]): string[] {
  const kept = keep.slice(0, MAX_ENTRIES);
  for (const stale of keep.slice(MAX_ENTRIES)) {
    try {
      sessionStorage.removeItem(PREFIX + stale);
    } catch {
      // ignore
    }
  }
  return kept;
}

/** Caller must be in the browser; every call site is inside an effect. */
export function cacheScan(scan: NormalizedScan): void {
  if (typeof window === 'undefined') return;

  // Both ids address the same payload, so a feed link and a fresh scan agree.
  const ids = [scan.scanId, scan.incidentId].filter((v): v is string => Boolean(v));
  const payload = JSON.stringify(scan);

  for (const key of ids) {
    try {
      sessionStorage.setItem(PREFIX + key, payload);
    } catch {
      // Most likely QuotaExceededError on a large Phase2 payload. Free the
      // oldest entries and retry once before giving up.
      const pruned = prune(readIndex().filter((k) => !ids.includes(k)).slice(0, 5));
      writeIndex(pruned);
      try {
        sessionStorage.setItem(PREFIX + key, payload);
      } catch {
        return;
      }
    }
  }

  const next = prune([...ids, ...readIndex().filter((k) => !ids.includes(k))]);
  writeIndex(next);
}

export function readCachedScan(id: string): NormalizedScan | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(PREFIX + id);
    return raw ? (JSON.parse(raw) as NormalizedScan) : null;
  } catch {
    return null;
  }
}

export function clearCachedScans(): void {
  if (typeof window === 'undefined') return;
  for (const key of readIndex()) {
    try {
      sessionStorage.removeItem(PREFIX + key);
    } catch {
      // ignore
    }
  }
  writeIndex([]);
}

/**
 * crypto.randomUUID is unavailable outside a secure context — which includes
 * demoing from a second machine over a LAN IP. Fall back rather than crash.
 */
export function newScanId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  const rand = Math.random().toString(16).slice(2, 10);
  return `vk-${Date.now().toString(16)}-${rand}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only a UUID can be a Supabase row id, so only then is a lookup worth trying. */
export const looksLikeUuid = (value: string): boolean => UUID_RE.test(value);
