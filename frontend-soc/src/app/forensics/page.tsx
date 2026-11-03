'use client';

/**
 * Forensics detail.
 *
 * The route is /forensics?id=<id>, not /forensics/[scanId], so the build stays
 * compatible with `output: 'export'` (GitHub Pages) — a static export cannot
 * pre-render a dynamic segment whose values are scan ids unknown at build time.
 * useSearchParams therefore needs a Suspense boundary.
 *
 * Resolution order: sessionStorage (full payload from this tab's own scan) ->
 * Supabase by row id (degraded, since forms/inputs/boxes are only partly
 * persisted) -> not found.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { BBoxOverlay } from '@/components/forensics/BBoxOverlay';
import { overlayBoxesFor, resolveSourceSpace } from '@/components/forensics/boxes';
import { ScoreBreakdownPanel } from '@/components/ui/ScoreBreakdown';
import { VerdictBadge } from '@/components/ui/VerdictBadge';
import { describeTarget, formatForensicTimestamp, defang } from '@/lib/format';
import { id as t } from '@/lib/i18n/id';
import { normalizeIncident, type IncidentRow, type NormalizedScan, type SourceSpace } from '@/lib/normalize';
import { getIncidentById } from '@/lib/api/endpoints';
import { looksLikeUuid, readCachedScan } from '@/lib/scan-store';
import { INCIDENTS_TABLE, getSupabase, isSupabaseConfigured } from '@/lib/supabase/client';

type LoadState =
  | { phase: 'loading' }
  | { phase: 'ready'; scan: NormalizedScan }
  | { phase: 'missing' }
  | { phase: 'error'; message: string };

function ForensicsContent() {
  const params = useSearchParams();
  const scanId = params.get('id');

  const [state, setState] = useState<LoadState>({ phase: 'loading' });
  const [measured, setMeasured] = useState<SourceSpace | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [showBurnedIn, setShowBurnedIn] = useState(false);
  const [defanged, setDefanged] = useState(true);

  useEffect(() => {
    if (!scanId) {
      setState({ phase: 'missing' });
      return;
    }

    let cancelled = false;

    // sessionStorage first: it holds the full payload when this tab ran the scan.
    const cached = readCachedScan(scanId);
    if (cached) {
      setState({ phase: 'ready', scan: cached });
      return;
    }

    // Only a UUID can be a stored row id, so anything else is a dead link.
    if (!looksLikeUuid(scanId)) {
      setState({ phase: 'missing' });
      return;
    }

    void (async () => {
      try {
        // Supabase when available: a single indexed lookup.
        if (isSupabaseConfigured()) {
          const { data, error } = await getSupabase()
            .from(INCIDENTS_TABLE)
            .select('*')
            .eq('id', scanId)
            .maybeSingle();
          if (cancelled) return;
          if (!error && data) {
            setState({ phase: 'ready', scan: normalizeIncident(data as IncidentRow) });
            return;
          }
        }

        // Otherwise go through the engine, which proxies the same rows. Without
        // this path every feed row would dead-end whenever the browser has no
        // Supabase credentials.
        const viaEngine = await getIncidentById(scanId);
        if (cancelled) return;
        setState(viaEngine ? { phase: 'ready', scan: viaEngine } : { phase: 'missing' });
      } catch (e) {
        if (!cancelled) {
          setState({ phase: 'error', message: e instanceof Error ? e.message : 'Gagal memuat' });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [scanId]);

  const scan = state.phase === 'ready' ? state.scan : null;
  const boxes = useMemo(() => (scan ? overlayBoxesFor(scan) : []), [scan]);
  const sourceSpace = useMemo(
    () => (scan ? resolveSourceSpace(scan, measured) : null),
    [scan, measured],
  );

  const onImageLoad = useCallback((space: SourceSpace) => setMeasured(space), []);

  if (state.phase === 'loading') {
    return <p className="p-8 text-sm text-[var(--muted)]">{t.common.loading}</p>;
  }

  if (state.phase === 'error') {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
        <h1 className="text-lg font-semibold text-[var(--verdict-critical)]">{t.common.error}</h1>
        <p className="mt-2 text-sm text-[var(--muted-strong)]">{state.message}</p>
      </div>
    );
  }

  if (state.phase === 'missing' || !scan) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
        <h1 className="text-lg font-semibold text-[var(--foreground)]">{t.forensics.notFound}</h1>
        <p className="mt-2 text-sm text-[var(--muted-strong)]">
          Insiden tidak tersedia di sesi ini. Buka dari Pusat Komando, atau jalankan pemindaian baru.
        </p>
        <Link
          href="/sandbox"
          className="mt-4 inline-block rounded bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white no-underline"
        >
          {t.nav.sandbox}
        </Link>
      </div>
    );
  }

  const target = scan.finalUrl ?? describeTarget(scan.submittedUrl);
  const evidenceUrl = showBurnedIn
    ? (scan.annotatedUrl ?? scan.screenshotUrl)
    : (scan.screenshotUrl ?? scan.annotatedUrl);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold text-[var(--foreground)]">
              {t.forensics.title}
            </h1>
            <VerdictBadge verdict={scan.verdict} size="lg" />
          </div>
          {/* Never an anchor: a live link to a phishing host on a SOC dashboard
              is exactly what a cyber jury looks for. */}
          <p className="vk-mono mt-1.5 break-all text-sm text-[var(--muted-strong)]">
            {defanged ? defang(target) : target}
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {formatForensicTimestamp(scan.createdAtIso)}
            {scan.ticket && ` · ${t.common.ticket} ${scan.ticket}`}
            {scan.reporterUnit && ` · ${scan.reporterUnit}`}
          </p>
        </div>

        <div className="vk-no-print flex gap-2">
          <button
            type="button"
            onClick={() => setDefanged((v) => !v)}
            aria-pressed={defanged}
            className="rounded border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--muted-strong)] hover:bg-[var(--surface-raised)]"
          >
            {t.common.defang}
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--muted-strong)] hover:bg-[var(--surface-raised)]"
          >
            {t.forensics.print}
          </button>
        </div>
      </header>

      {scan.degraded && (
        <p className="rounded border-l-2 border-l-[var(--verdict-suspicious)] bg-[var(--surface-raised)] px-3 py-2 text-xs text-[var(--muted-strong)]">
          {t.forensics.degraded}
        </p>
      )}
      {!scan.synced && !scan.degraded && (
        <p className="rounded border-l-2 border-l-[var(--verdict-suspicious)] bg-[var(--surface-raised)] px-3 py-2 text-xs text-[var(--muted-strong)]">
          {t.forensics.notSynced}
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_minmax(22rem,32%)]">
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h2 className="text-sm font-semibold text-[var(--foreground)]">
              {t.forensics.evidence}
            </h2>
            {scan.annotatedUrl && scan.screenshotUrl && (
              <button
                type="button"
                onClick={() => setShowBurnedIn((v) => !v)}
                className="vk-no-print rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted-strong)] hover:bg-[var(--surface-raised)]"
              >
                {showBurnedIn ? t.forensics.rawView : t.forensics.burnedView}
              </button>
            )}
          </div>

          {evidenceUrl ? (
            <BBoxOverlay
              imageUrl={evidenceUrl}
              // The burned-in image already has boxes drawn into it.
              boxes={showBurnedIn ? [] : boxes}
              sourceSpace={sourceSpace}
              highlightedId={highlighted}
              onHighlight={setHighlighted}
              onImageLoad={onImageLoad}
            />
          ) : (
            <p className="text-sm text-[var(--muted)]">Tidak ada bukti visual tersimpan.</p>
          )}
        </section>

        <div className="flex flex-col gap-5">
          <ScoreBreakdownPanel scores={scan.scores} appliedRules={scan.appliedRules} />

          {scan.forensicReasons.length > 0 && (
            <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
              <h2 className="mb-2 text-sm font-semibold text-[var(--foreground)]">
                {t.forensics.findings}
              </h2>
              <ul className="flex flex-col gap-1.5">
                {scan.forensicReasons.map((reason) => (
                  <li
                    key={reason}
                    className="text-xs leading-snug text-[var(--muted-strong)] before:mr-1.5 before:text-[var(--muted)] before:content-['•']"
                  >
                    {reason}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ForensicsPage() {
  // useSearchParams suspends during prerender; without this the build fails.
  return (
    <Suspense fallback={<p className="p-8 text-sm text-[var(--muted)]">{t.common.loading}</p>}>
      <ForensicsContent />
    </Suspense>
  );
}
