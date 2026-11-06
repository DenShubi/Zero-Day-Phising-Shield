'use client';

/**
 * Forensik panel: dominant >= 64% interactive visual evidence canvas on the left,
 * collapsible dense telemetry/score rail on the right, seamless link to Mitigasi,
 * and white-ground @media print incident report support.
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type MouseEvent } from 'react';
import { useRouter } from 'next/navigation';
import { BBoxOverlay } from '@/components/forensics/BBoxOverlay';
import {
  overlayBoxesFor,
  resolveSourceSpace,
  shouldPreferBurnedIn,
} from '@/components/forensics/boxes';
import { DomTelemetry } from '@/components/forensics/DomTelemetry';
import { LatencyWaterfall } from '@/components/forensics/LatencyWaterfall';
import { MultimodalPanel } from '@/components/forensics/MultimodalPanel';
import { RedirectLadder } from '@/components/forensics/RedirectLadder';
import { SideBySide } from '@/components/forensics/SideBySide';
import { ScoreBreakdownPanel } from '@/components/ui/ScoreBreakdown';
import { VerdictBadge } from '@/components/ui/VerdictBadge';
import {
  IconAlertTriangle,
  IconLockDefang,
  IconMitigation,
  IconOctagonAlert,
  IconPrint,
  IconRefresh,
  IconScan,
  IconSidebarCollapse,
  IconSidebarExpand,
} from '@/components/ui/icons';
import { ApiError } from '@/lib/api/client';
import { getIncidentById, scanUrl } from '@/lib/api/endpoints';
import { defang, describeTarget, formatForensicTimestamp, truncateMiddle } from '@/lib/format';
import { id as t } from '@/lib/i18n/id';
import {
  normalizeIncident,
  type IncidentRow,
  type NormalizedScan,
  type SourceSpace,
} from '@/lib/normalize';
import { buildPanelHref } from '@/lib/panel-route';
import { cacheScan, looksLikeUuid, newScanId, readCachedScan } from '@/lib/scan-store';
import { INCIDENTS_TABLE, getSupabase, isSupabaseConfigured } from '@/lib/supabase/client';

type StageTab = 'evidence' | 'diff';

type AsyncLookupResult =
  | { id: string; outcome: 'ready'; scan: NormalizedScan }
  | { id: string; outcome: 'missing' }
  | { id: string; outcome: 'error'; message: string };

function extractHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    return new URL(raw).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

function ForensicsDetailView({
  initialScan,
  incidents,
  onScanUpdated,
}: {
  initialScan: NormalizedScan;
  incidents: readonly NormalizedScan[];
  onScanUpdated?: (scan: NormalizedScan) => void;
}) {
  const router = useRouter();
  const [rescanOverride, setRescanOverride] = useState<NormalizedScan | null>(null);
  const [measured, setMeasured] = useState<SourceSpace | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [viewOverride, setViewOverride] = useState<boolean | null>(null);
  const [stageTab, setStageTab] = useState<StageTab>('evidence');
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [defanged, setDefanged] = useState(true);
  const [rescanning, setRescanning] = useState(false);
  const [rescanError, setRescanError] = useState<string | null>(null);

  const scan = rescanOverride ?? initialScan;
  const boxes = useMemo(() => overlayBoxesFor(scan), [scan]);
  const sourceSpace = useMemo(() => resolveSourceSpace(scan, measured), [scan, measured]);

  const onImageLoad = useCallback((space: SourceSpace) => setMeasured(space), []);

  const rescan = useCallback(async () => {
    if (!scan.submittedUrl || scan.kind !== 'URL' || rescanning) return;
    setRescanning(true);
    setRescanError(null);
    try {
      const fresh = await scanUrl(scan.submittedUrl, {
        scanId: newScanId(),
        reporterUnit: scan.reporterUnit ?? undefined,
      });
      cacheScan(fresh);
      onScanUpdated?.(fresh);
      setMeasured(null);
      setRescanOverride(fresh);
      router.replace(
        buildPanelHref('forensik', { insiden: fresh.incidentId ?? fresh.scanId }),
        { scroll: false },
      );
    } catch (e) {
      setRescanError(e instanceof ApiError ? e.detail : t.forensics.rescanFailed);
    } finally {
      setRescanning(false);
    }
  }, [scan, rescanning, onScanUpdated, router]);

  const target = scan.finalUrl ?? describeTarget(scan.submittedUrl);
  const candidateHost = extractHost(scan.finalUrl ?? scan.submittedUrl);
  const showBurnedIn = viewOverride ?? shouldPreferBurnedIn(scan, boxes);
  const evidenceUrl = showBurnedIn
    ? (scan.annotatedUrl ?? scan.screenshotUrl)
    : (scan.screenshotUrl ?? scan.annotatedUrl);

  const canRescan = scan.degraded && scan.kind === 'URL' && Boolean(scan.submittedUrl);
  const activeOptionValue = scan.incidentId ?? scan.scanId;

  return (
    <section className="vk-panel-section">
      {/* Compact Forensic Title Row */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="max-w-[54rem]">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[1.5rem] leading-[1.25] font-semibold tracking-[-0.02em] text-[var(--foreground)]">
              {t.forensics.title}
            </h1>
            <VerdictBadge verdict={scan.verdict} size="lg" />
            <span className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 text-[0.8125rem] text-[var(--muted-strong)]">
              {scan.degraded ? t.forensics.archiveBadge : t.forensics.liveSessionBadge}
            </span>
          </div>

          <p className="mt-0.5 text-[0.875rem] text-[var(--muted-strong)]">
            {t.forensics.subtitle}
          </p>

          <p className="vk-mono mt-1 break-all text-[0.875rem] text-[var(--foreground)]">
            {defanged ? defang(target) : target}
          </p>
        </div>

        <button
          type="button"
          onClick={() =>
            router.replace(
              candidateHost && scan.verdict !== 'SAFE'
                ? buildPanelHref('mitigasi', { host: candidateHost })
                : buildPanelHref('pemindaian'),
              { scroll: false },
            )
          }
          className="vk-btn vk-btn-primary h-9 px-3.5 text-[0.875rem]"
        >
          {candidateHost && scan.verdict !== 'SAFE' ? (
            <IconMitigation size={15} />
          ) : (
            <IconScan size={15} />
          )}
          <span>
            {candidateHost && scan.verdict !== 'SAFE'
              ? t.forensics.sendToMitigation
              : t.command.ctaLaunchScan}
          </span>
        </button>
      </div>

      {/* Interactive Forensic Workspace */}
      <div data-ui="console-workspace" className="flex min-h-0 flex-1 flex-col gap-3">
        {/* Metadata + Operator Toolbar (.vk-no-print on toolbar so print report stays clean) */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.8125rem] text-[var(--muted)]">
            <span className="vk-mono vk-tabular">{formatForensicTimestamp(scan.createdAtIso)}</span>
            {scan.ticket && (
              <span className="vk-mono">
                · {t.common.ticket} {scan.ticket}
              </span>
            )}
            {scan.reporterUnit && <span>· {scan.reporterUnit}</span>}
            {scan.contentCategory && <span>· {scan.contentCategory}</span>}
          </div>

          <div className="vk-no-print flex flex-wrap items-center gap-2">
            {incidents.length > 0 && (
              <select
                aria-label={t.forensics.selectIncidentLabel}
                value={activeOptionValue}
                onChange={(e) =>
                  router.replace(buildPanelHref('forensik', { insiden: e.target.value }), {
                    scroll: false,
                  })
                }
                className="h-9 max-w-[14rem] rounded-lg border border-[var(--border-strong)] bg-[var(--surface-1)] px-2.5 text-[0.8125rem] text-[var(--foreground)]"
              >
                {!incidents.some((i) => (i.incidentId ?? i.scanId) === activeOptionValue) && (
                  <option value={activeOptionValue}>
                    {scan.ticket ?? truncateMiddle(describeTarget(scan.submittedUrl), 28)}
                  </option>
                )}
                {incidents.slice(0, 25).map((item) => {
                  const val = item.incidentId ?? item.scanId;
                  const label = item.ticket
                    ? `${item.ticket} — ${truncateMiddle(describeTarget(item.submittedUrl), 24)}`
                    : truncateMiddle(describeTarget(item.submittedUrl), 34);
                  return (
                    <option key={val} value={val}>
                      {label}
                    </option>
                  );
                })}
              </select>
            )}

            <button
              type="button"
              onClick={() => setDefanged((v) => !v)}
              aria-pressed={defanged}
              className={[
                'vk-btn h-9 px-3 text-[0.8125rem]',
                defanged
                  ? 'vk-btn-secondary border-[var(--accent-border)] text-[var(--accent-ink)]'
                  : 'vk-btn-secondary',
              ].join(' ')}
            >
              <IconLockDefang size={14} />
              <span>{t.common.defang}</span>
            </button>

            <button
              type="button"
              onClick={() => window.print()}
              className="vk-btn vk-btn-secondary h-9 px-3 text-[0.8125rem]"
            >
              <IconPrint size={15} />
              <span>{t.forensics.print}</span>
            </button>

            <button
              type="button"
              onClick={() => setRailCollapsed((v) => !v)}
              aria-pressed={railCollapsed}
              title={railCollapsed ? t.forensics.expandInspector : t.forensics.collapseInspector}
              className="vk-btn vk-btn-secondary hidden h-9 px-2.5 text-[0.8125rem] lg:inline-flex"
            >
              {railCollapsed ? <IconSidebarCollapse size={15} /> : <IconSidebarExpand size={15} />}
              <span>
                {railCollapsed ? t.forensics.expandInspector : t.forensics.collapseInspector}
              </span>
            </button>
          </div>
        </div>

        {/* Degraded / Rescan / Sync Status Banner */}
        {(scan.degraded || rescanError || (!scan.synced && !scan.degraded)) && (
          <div className="vk-no-print flex shrink-0 flex-col gap-1.5">
            {scan.degraded && (
              <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-lg border border-[var(--border)] border-l-2 border-l-[var(--verdict-suspicious)] bg-[var(--surface-1)] px-3.5 py-2 text-[0.8125rem] text-[var(--muted-strong)]">
                <span className="inline-flex items-center gap-2">
                  <span className="text-[var(--verdict-suspicious)]">
                    <IconAlertTriangle size={14} />
                  </span>
                  <span>{t.forensics.degraded}</span>
                </span>
                {canRescan && (
                  <button
                    type="button"
                    onClick={() => void rescan()}
                    disabled={rescanning}
                    className="vk-btn vk-btn-primary h-7 px-2.5 text-[0.8125rem]"
                  >
                    <IconRefresh size={13} />
                    <span>{rescanning ? t.forensics.rescanning : t.forensics.rescan}</span>
                  </button>
                )}
              </div>
            )}

            {rescanError && (
              <div className="flex items-start gap-2 rounded-lg border border-[var(--border)] border-l-2 border-l-[var(--verdict-critical)] bg-[var(--surface-1)] px-3.5 py-2 text-[0.8125rem] text-[var(--foreground)]">
                <span className="mt-0.5 shrink-0 text-[var(--verdict-critical)]" aria-hidden="true">
                  <IconOctagonAlert size={14} />
                </span>
                <span>{rescanError}</span>
              </div>
            )}

            {!scan.synced && !scan.degraded && (
              <div className="rounded-lg border border-[var(--border)] border-l-2 border-l-[var(--verdict-suspicious)] bg-[var(--surface-1)] px-3.5 py-2 text-[0.8125rem] text-[var(--muted-strong)]">
                {t.forensics.notSynced}
              </div>
            )}
          </div>
        )}

        {/* Main Split Stage: >= 65% Visual Evidence Canvas + Collapsible Right Inspector Rail */}
        <div
          className={[
            'grid min-h-0 flex-1 gap-3.5',
            railCollapsed ? 'lg:grid-cols-1' : 'lg:grid-cols-[minmax(0,1.9fr)_minmax(21rem,1fr)]',
          ].join(' ')}
        >
          {/* Left Dominant Evidence Stage */}
          <div className="vk-scroll flex min-h-0 min-w-0 flex-col gap-3.5 overflow-y-auto pr-1">
            <div className="vk-bento min-w-0 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[1.125rem] leading-[1.35] font-semibold tracking-[-0.01em] text-[var(--foreground)]">
                    {t.forensics.evidence}
                  </h3>

                  <div className="vk-no-print flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-0.5">
                    <button
                      type="button"
                      onClick={() => setStageTab('evidence')}
                      aria-pressed={stageTab === 'evidence'}
                      className={[
                        'rounded-md px-2.5 py-1 text-[0.8125rem] font-medium transition-colors',
                        stageTab === 'evidence'
                          ? 'bg-[var(--accent-tint)] text-[var(--foreground)]'
                          : 'text-[var(--muted-strong)] hover:text-[var(--foreground)]',
                      ].join(' ')}
                    >
                      {t.forensics.tabEvidence}
                    </button>
                    <button
                      type="button"
                      onClick={() => setStageTab('diff')}
                      aria-pressed={stageTab === 'diff'}
                      className={[
                        'rounded-md px-2.5 py-1 text-[0.8125rem] font-medium transition-colors',
                        stageTab === 'diff'
                          ? 'bg-[var(--accent-tint)] text-[var(--foreground)]'
                          : 'text-[var(--muted-strong)] hover:text-[var(--foreground)]',
                      ].join(' ')}
                    >
                      {t.forensics.tabDiff}
                    </button>
                  </div>
                </div>

                {stageTab === 'evidence' && scan.annotatedUrl && scan.screenshotUrl && (
                  <button
                    type="button"
                    onClick={() => setViewOverride(!showBurnedIn)}
                    className="vk-no-print vk-btn vk-btn-secondary h-8 px-2.5 text-[0.8125rem]"
                  >
                    {showBurnedIn ? t.forensics.rawView : t.forensics.burnedView}
                  </button>
                )}
              </div>

              {stageTab === 'evidence' ? (
                evidenceUrl ? (
                  <BBoxOverlay
                    imageUrl={evidenceUrl}
                    boxes={showBurnedIn ? [] : boxes}
                    sourceSpace={sourceSpace}
                    highlightedId={highlighted}
                    onHighlight={setHighlighted}
                    onImageLoad={onImageLoad}
                  />
                ) : (
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-4 py-6 text-[0.875rem] text-[var(--muted)]">
                    {t.forensics.noVisualEvidence}
                  </div>
                )
              ) : (
                <SideBySide
                  evidenceUrl={scan.screenshotUrl ?? scan.annotatedUrl}
                  impersonatedTarget={scan.impersonatedTarget}
                  visualScore={scan.scores.visual}
                />
              )}
            </div>

            {stageTab === 'evidence' && (
              <SideBySide
                evidenceUrl={scan.screenshotUrl ?? scan.annotatedUrl}
                impersonatedTarget={scan.impersonatedTarget}
                visualScore={scan.scores.visual}
              />
            )}

            {scan.url && (
              <DomTelemetry
                url={scan.url}
                highlightedId={highlighted}
                onHighlight={setHighlighted}
                defanged={defanged}
              />
            )}

            {scan.image && (
              <MultimodalPanel
                image={scan.image}
                highlightedId={highlighted}
                onHighlight={setHighlighted}
                defanged={defanged}
              />
            )}

            {scan.url && scan.url.redirectChain.length > 0 && (
              <RedirectLadder chain={scan.url.redirectChain} defanged={defanged} />
            )}
          </div>

          {/* Right Collapsible Inspector Rail */}
          {!railCollapsed && (
            <div className="vk-scroll flex min-h-0 min-w-0 flex-col gap-3.5 overflow-y-auto pr-0.5">
              <ScoreBreakdownPanel scores={scan.scores} appliedRules={scan.appliedRules} />

              <div className="vk-bento min-w-0 p-4">
                <h3 className="text-[1.125rem] leading-[1.35] font-semibold tracking-[-0.01em] text-[var(--foreground)]">
                  {t.forensics.findings}
                </h3>
                {scan.forensicReasons.length === 0 ? (
                  <div className="mt-2 text-[0.8125rem] text-[var(--muted)]">
                    {t.forensics.noFindings}
                  </div>
                ) : (
                  /* The cap only applies where the side rail is a fixed
                     column. Once the layout stacks, the rail scrolls as a
                     whole, and a capped list inside it is a scroll area within
                     a scroll area that leaves findings half-drawn at its own
                     boundary. */
                  <ul className="vk-scroll mt-2.5 flex flex-col gap-2 overflow-y-auto pr-0.5 xl:max-h-44">
                    {scan.forensicReasons.map((reason) => (
                      <li
                        key={reason}
                        className="flex items-start gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-2 text-[0.8125rem] leading-snug text-[var(--foreground)]"
                      >
                        <span className="mt-0.5 shrink-0 text-[var(--verdict-critical)]">
                          <IconOctagonAlert size={13} />
                        </span>
                        <span className="min-w-0 flex-1">{reason}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <LatencyWaterfall latencyMs={scan.latencyMs} />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export function ForensicsPanel({
  requestedId,
  incidents,
  onScanUpdated,
}: {
  requestedId: string | null;
  incidents: readonly NormalizedScan[];
  onScanUpdated?: (scan: NormalizedScan) => void;
}) {
  const router = useRouter();
  const isClient = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [asyncLookup, setAsyncLookup] = useState<AsyncLookupResult | null>(null);

  const fallbackIncident = useMemo(
    () => incidents.find((i) => i.verdict === 'CRITICAL_PHISHING') ?? incidents[0] ?? null,
    [incidents],
  );

  const effectiveId =
    requestedId ?? fallbackIncident?.incidentId ?? fallbackIncident?.scanId ?? null;

  // Synchronous local resolution: sessionStorage first, then live feed.
  const localScan = useMemo(() => {
    if (!effectiveId) return null;
    if (isClient) {
      const cached = readCachedScan(effectiveId);
      if (cached) return cached;
    }
    return (
      incidents.find((i) => i.incidentId === effectiveId || i.scanId === effectiveId) ?? null
    );
  }, [effectiveId, incidents, isClient]);

  const needsRemoteFetch = Boolean(effectiveId && !localScan && looksLikeUuid(effectiveId));

  useEffect(() => {
    if (!needsRemoteFetch || !effectiveId) return;

    let cancelled = false;
    void (async () => {
      try {
        if (isSupabaseConfigured()) {
          const { data, error } = await getSupabase()
            .from(INCIDENTS_TABLE)
            .select('*')
            .eq('id', effectiveId)
            .maybeSingle();
          if (cancelled) return;
          if (!error && data) {
            setAsyncLookup({
              id: effectiveId,
              outcome: 'ready',
              scan: normalizeIncident(data as IncidentRow),
            });
            return;
          }
        }

        const viaEngine = await getIncidentById(effectiveId);
        if (cancelled) return;
        setAsyncLookup(
          viaEngine
            ? { id: effectiveId, outcome: 'ready', scan: viaEngine }
            : { id: effectiveId, outcome: 'missing' },
        );
      } catch (e) {
        if (!cancelled) {
          setAsyncLookup({
            id: effectiveId,
            outcome: 'error',
            message: e instanceof Error ? e.message : t.forensics.loadFailed,
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [needsRemoteFetch, effectiveId]);

  const goScan = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    router.replace(buildPanelHref('pemindaian'), { scroll: false });
  };

  if (localScan) {
    return (
      <ForensicsDetailView
        key={localScan.incidentId ?? localScan.scanId}
        initialScan={localScan}
        incidents={incidents}
        onScanUpdated={onScanUpdated}
      />
    );
  }

  if (needsRemoteFetch && asyncLookup?.id !== effectiveId) {
    return (
      <section className="vk-panel-section">
        <div className="shrink-0">
          <h1 className="text-[1.5rem] leading-[1.25] font-semibold tracking-[-0.02em] text-[var(--foreground)]">
            {t.forensics.title}
          </h1>
        </div>
        <div
          data-ui="console-workspace"
          className="vk-bento flex flex-1 items-center justify-center gap-3 p-8 text-[0.875rem] text-[var(--muted-strong)]"
        >
          <span
            aria-hidden="true"
            className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--border-strong)] border-t-[var(--accent-ink)]"
          />
          <span>{t.common.loading}</span>
        </div>
      </section>
    );
  }

  if (asyncLookup?.id === effectiveId && asyncLookup.outcome === 'ready') {
    return (
      <ForensicsDetailView
        key={asyncLookup.scan.incidentId ?? asyncLookup.scan.scanId}
        initialScan={asyncLookup.scan}
        incidents={incidents}
        onScanUpdated={onScanUpdated}
      />
    );
  }

  if (asyncLookup?.id === effectiveId && asyncLookup.outcome === 'error') {
    return (
      <section className="vk-panel-section">
        <div className="shrink-0">
          <h1 className="text-[1.5rem] leading-[1.25] font-semibold tracking-[-0.02em] text-[var(--foreground)]">
            {t.forensics.title}
          </h1>
        </div>
        <div data-ui="console-workspace" className="grid min-h-0 flex-1 gap-3.5 lg:grid-cols-12">
          <div className="vk-bento flex flex-col justify-between border-l-2 border-l-[var(--verdict-critical)] p-6 lg:col-span-8">
            <div>
              <div className="flex items-center gap-2 text-[var(--verdict-critical)]">
                <IconOctagonAlert size={18} />
                <h3 className="text-[1.125rem] leading-[1.35] font-semibold tracking-[-0.01em] text-[var(--foreground)]">
                  {t.common.error}
                </h3>
              </div>
              <p className="mt-2 text-[1rem] leading-[1.55] text-[var(--muted-strong)]">
                {asyncLookup.message}
              </p>
            </div>
            <a
              href={buildPanelHref('pemindaian')}
              onClick={goScan}
              className="vk-btn vk-btn-primary mt-4 h-9 w-fit px-4 text-[0.875rem] no-underline"
            >
              <IconScan size={16} />
              <span>{t.forensics.goToScan}</span>
            </a>
          </div>
          <div className="vk-bento flex flex-col justify-between p-5 lg:col-span-4">
            <h3 className="text-[1.125rem] leading-[1.35] font-semibold tracking-[-0.01em] text-[var(--foreground)]">
              {t.forensics.evidence}
            </h3>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-4 text-[0.875rem] text-[var(--muted)]">
              {t.forensics.noVisualEvidence}
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="vk-panel-section">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="max-w-[54rem]">
          <h1 className="text-[1.5rem] leading-[1.25] font-semibold tracking-[-0.02em] text-[var(--foreground)]">
            {t.forensics.title}
          </h1>
          <p className="mt-0.5 text-[0.875rem] text-[var(--muted-strong)]">
            {t.forensics.subtitle}
          </p>
        </div>
        <button
          type="button"
          onClick={() => router.replace(buildPanelHref('pemindaian'), { scroll: false })}
          className="vk-btn vk-btn-primary h-9 px-3.5 text-[0.875rem]"
        >
          <IconScan size={15} />
          <span>{t.command.ctaLaunchScan}</span>
        </button>
      </div>

      <div data-ui="console-workspace" className="grid min-h-0 flex-1 gap-3.5 lg:grid-cols-12">
        <div className="vk-bento flex min-h-0 flex-col justify-start p-5 lg:col-span-8">
          <div>
            <h3 className="text-[1.125rem] leading-[1.35] font-semibold tracking-[-0.01em] text-[var(--foreground)]">
              {t.forensics.notFound}
            </h3>
            <p className="mt-1.5 max-w-[58ch] text-[0.875rem] leading-[1.5] text-[var(--muted-strong)]">
              {t.forensics.notFoundHint}
            </p>
            <a
              href={buildPanelHref('pemindaian')}
              onClick={goScan}
              className="vk-btn vk-btn-primary mt-3 h-8.5 w-fit px-3.5 text-[0.8125rem] no-underline"
            >
              <IconScan size={15} />
              <span>{t.forensics.goToScan}</span>
            </a>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
              <div className="text-[0.8125rem] font-medium text-[var(--foreground)]">
                {t.forensics.tabEvidence}
              </div>
              <div className="mt-1 text-[0.75rem] text-[var(--muted)]">
                {t.forensics.noVisualEvidence}
              </div>
            </div>
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
              <div className="text-[0.8125rem] font-medium text-[var(--foreground)]">
                {t.forensics.tabDiff}
              </div>
              <div className="mt-1 text-[0.75rem] text-[var(--muted)]">
                {t.forensics.noReference}
              </div>
            </div>
          </div>
        </div>

        <div className="vk-bento flex min-h-0 flex-col justify-start p-5 lg:col-span-4">
          <div>
            <h3 className="text-[1.125rem] leading-[1.35] font-semibold tracking-[-0.01em] text-[var(--foreground)]">
              {t.forensics.findings}
            </h3>
            <div className="mt-1.5 text-[0.8125rem] text-[var(--muted)]">
              {t.forensics.noFindings}
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3 text-[0.75rem] text-[var(--muted)]">
            {t.forensics.domEmpty}
          </div>
        </div>
      </div>
    </section>
  );
}
