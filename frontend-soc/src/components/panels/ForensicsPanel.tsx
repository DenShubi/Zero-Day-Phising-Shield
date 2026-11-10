'use client';

/**
 * Halaman Detail Bukti Pemindaian:
 * - Kiri (8 kolom): Bukti Visual (Tangkapan Layar / Perbandingan Portal Resmi) + Detail Teknis
 * - Kanan (4 kolom): Skor Risiko + Alasan & Temuan Utama
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type MouseEvent,
} from 'react';
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
} from '@/components/ui/icons';
import { ApiError } from '@/lib/api/client';
import { getIncidentById, scanUrl } from '@/lib/api/endpoints';
import {
  defang,
  describeTarget,
  formatForensicTimestamp,
  truncateMiddle,
} from '@/lib/format';
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
type DockTab = 'dom' | 'multimodal' | 'redirect' | 'latency';

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

function cleanTarget(raw: string): string {
  return raw.replace(/\s*\u2014\s*/g, ': ');
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
  const [defanged, setDefanged] = useState(true);
  const [rescanning, setRescanning] = useState(false);
  const [rescanError, setRescanError] = useState<string | null>(null);

  const scan = rescanOverride ?? initialScan;
  const [dockTab, setDockTab] = useState<DockTab>(
    scan.kind === 'IMAGE' && scan.image ? 'multimodal' : 'dom',
  );

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

  const target = cleanTarget(scan.finalUrl ?? describeTarget(scan.submittedUrl));
  const candidateHost = extractHost(scan.finalUrl ?? scan.submittedUrl);
  const showBurnedIn = viewOverride ?? shouldPreferBurnedIn(scan, boxes);
  const evidenceUrl = showBurnedIn
    ? (scan.annotatedUrl ?? scan.screenshotUrl)
    : (scan.screenshotUrl ?? scan.annotatedUrl);

  const canRescan = scan.degraded && scan.kind === 'URL' && Boolean(scan.submittedUrl);
  const activeOptionValue = scan.incidentId ?? scan.scanId;

  const domFieldCount = scan.url?.inputs.length ?? 0;
  const qrCount = (scan.image?.qrCodes.length ?? 0) + (scan.image?.extractedUrls.length ?? 0);
  const redirectCount = scan.url?.redirectChain.length ?? 0;

  return (
    <section className="vk-panel-section">
      {/* Strip konteks: target yang diperiksa adalah judulnya, bukan kata "Bukti". */}
      <header className="vk-page-header">
        <div className="flex min-w-0 max-w-[54rem] flex-wrap items-center gap-x-2.5 gap-y-1">
          <VerdictBadge verdict={scan.verdict} size="sm" />
          <h1
            id="vk-main-heading"
            tabIndex={-1}
            className="vk-mono min-w-0 truncate text-[0.84rem] font-medium text-[var(--foreground)] outline-none"
          >
            {defanged ? defang(target) : target}
          </h1>
          {scan.ticket && (
            <span className="vk-mono text-[0.72rem] text-[var(--muted)]">{scan.ticket}</span>
          )}
          <span className="vk-tabular text-[0.72rem] text-[var(--muted)]">
            {formatForensicTimestamp(scan.createdAtIso)}
          </span>
        </div>

        {/* Bilah Alat */}
        <div className="vk-no-print flex flex-wrap items-center gap-1.5">
          {incidents.length > 1 && (
            <select
              aria-label={t.forensics.selectIncidentLabel}
              value={activeOptionValue}
              onChange={(e) =>
                router.replace(buildPanelHref('forensik', { insiden: e.target.value }), {
                  scroll: false,
                })
              }
              className="vk-input h-8 max-w-[14rem] text-[0.75rem]"
            >
              {incidents.slice(0, 30).map((item) => {
                const idVal = item.incidentId ?? item.scanId;
                const cleanDesc = cleanTarget(describeTarget(item.submittedUrl));
                return (
                  <option key={idVal} value={idVal}>
                    {item.ticket ?? `#${idVal.slice(0, 8)}`} · {truncateMiddle(cleanDesc, 28)}
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
              'vk-btn vk-btn-secondary h-8 px-2.5 text-[0.75rem]',
              defanged ? 'border-[var(--accent-border)] text-[var(--accent-ink)]' : '',
            ].join(' ')}
          >
            <IconLockDefang size={13} />
            <span>{t.common.defang}</span>
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="vk-btn vk-btn-secondary h-8 px-2.5 text-[0.75rem]"
          >
            <IconPrint size={13} />
            <span>{t.forensics.print}</span>
          </button>

          <button
            type="button"
            onClick={() =>
              router.replace(
                candidateHost && scan.verdict !== 'SAFE'
                  ? buildPanelHref('respons', { tab: 'blokir', host: candidateHost })
                  : buildPanelHref('beranda'),
                { scroll: false },
              )
            }
            className="vk-btn vk-btn-primary h-8 shrink-0 px-3 text-[0.75rem]"
          >
            {candidateHost && scan.verdict !== 'SAFE' ? (
              <IconMitigation size={14} />
            ) : (
              <IconScan size={14} />
            )}
            <span>
              {candidateHost && scan.verdict !== 'SAFE'
                ? t.forensics.sendToMitigation
                : t.command.ctaLaunchScan}
            </span>
          </button>
        </div>
      </header>

      {/* Pemberitahuan Arsip / Pindai Ulang */}
      {(scan.degraded || rescanError) && (
        <div className="vk-no-print shrink-0 divide-y divide-[var(--border)] border-b border-[var(--border)] bg-[var(--surface-2)]">
          {scan.degraded && (
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-1.5 text-[0.75rem] text-[var(--muted-strong)]">
              <span className="inline-flex items-center gap-2">
                <span className="text-[var(--verdict-suspicious)]" aria-hidden="true">
                  <IconAlertTriangle size={13} />
                </span>
                <span>{t.forensics.degraded}</span>
              </span>
              {canRescan && (
                <button
                  type="button"
                  onClick={() => void rescan()}
                  disabled={rescanning}
                  className="vk-btn vk-btn-primary h-6 px-2.5 text-[0.72rem]"
                >
                  <IconRefresh size={11} />
                  <span>{rescanning ? t.forensics.rescanning : t.forensics.rescan}</span>
                </button>
              )}
            </div>
          )}

          {rescanError && (
            <div
              role="alert"
              className="flex items-start gap-2 px-4 py-1.5 text-[0.75rem] text-[var(--foreground)]"
            >
              <span className="mt-0.5 shrink-0 text-[var(--verdict-critical)]" aria-hidden="true">
                <IconOctagonAlert size={13} />
              </span>
              <span>{rescanError}</span>
            </div>
          )}
        </div>
      )}

      {/* 2-Kolom Utama: Bukti Visual & Detail Teknis (8 Kolom) | Skor & Temuan (4 Kolom) */}
      <div
        data-ui="console-workspace"
        className="grid min-h-0 flex-1 divide-y divide-[var(--border)] lg:grid-cols-12 lg:divide-x lg:divide-y-0"
      >
        <div className="vk-scroll flex min-h-0 min-w-0 flex-col divide-y divide-[var(--border)] overflow-y-auto bg-[var(--surface-1)] lg:col-span-8">
          {/* Kanvas Bukti Visual */}
          <div className="p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="vk-no-print vk-nav-track">
                {(
                  [
                    ['evidence', t.forensics.tabEvidence],
                    ['diff', t.forensics.tabDiff],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setStageTab(key)}
                    aria-current={stageTab === key ? 'page' : undefined}
                    className="vk-nav-tab"
                  >
                    {label}
                  </button>
                ))}
              </div>

              {stageTab === 'evidence' && scan.annotatedUrl && scan.screenshotUrl && (
                <button
                  type="button"
                  onClick={() => setViewOverride(!showBurnedIn)}
                  className="vk-no-print vk-btn vk-btn-secondary h-7 px-2.5 text-[0.75rem]"
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
                <div className="rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface-0)] px-4 py-6 text-[0.8125rem] text-[var(--muted)]">
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

          {/* Detail Teknis */}
          <div className="bg-[var(--surface-0)]">
            <div className="vk-no-print flex flex-wrap items-center gap-1.5 border-b border-[var(--border)] bg-[var(--surface-1)] px-4 py-2">
              {scan.kind === 'URL' && (
                <button
                  type="button"
                  onClick={() => setDockTab('dom')}
                  data-active={dockTab === 'dom' ? 'true' : undefined}
                className="vk-chip h-7 text-[0.75rem]"
                >
                  Formulir &amp; Halaman ({domFieldCount})
                </button>
              )}

              {scan.kind === 'IMAGE' && (
                <button
                  type="button"
                  onClick={() => setDockTab('multimodal')}
                  data-active={dockTab === 'multimodal' ? 'true' : undefined}
                className="vk-chip h-7 text-[0.75rem]"
                >
                  Kode QR &amp; Teks ({qrCount})
                </button>
              )}

              {scan.kind === 'URL' && redirectCount > 0 && (
                <button
                  type="button"
                  onClick={() => setDockTab('redirect')}
                  data-active={dockTab === 'redirect' ? 'true' : undefined}
                className="vk-chip h-7 text-[0.75rem]"
                >
                  Pengalihan URL ({redirectCount})
                </button>
              )}

              <button
                type="button"
                onClick={() => setDockTab('latency')}
                data-active={dockTab === 'latency' ? 'true' : undefined}
                className="vk-chip h-7 text-[0.75rem]"
              >
                Waktu Proses
              </button>
            </div>

            <div>
              {dockTab === 'dom' &&
                (scan.url ? (
                  <DomTelemetry
                    url={scan.url}
                    highlightedId={highlighted}
                    onHighlight={setHighlighted}
                    defanged={defanged}
                  />
                ) : (
                  <div className="p-4 text-[0.78rem] text-[var(--muted)]">
                    {t.forensics.domEmpty}
                  </div>
                ))}

              {dockTab === 'multimodal' &&
                (scan.image ? (
                  <MultimodalPanel
                    image={scan.image}
                    highlightedId={highlighted}
                    onHighlight={setHighlighted}
                    defanged={defanged}
                  />
                ) : null)}

              {dockTab === 'redirect' &&
                scan.url &&
                scan.url.redirectChain.length > 0 && (
                  <RedirectLadder chain={scan.url.redirectChain} defanged={defanged} />
                )}

              {dockTab === 'latency' && <LatencyWaterfall latencyMs={scan.latencyMs} />}
            </div>
          </div>
        </div>

        {/* Kolom Kanan: Skor & Alasan Temuan */}
        <aside className="vk-scroll flex min-h-0 min-w-0 flex-col divide-y divide-[var(--border)] overflow-y-auto bg-[var(--surface-0)] lg:col-span-4">
          <ScoreBreakdownPanel scores={scan.scores} appliedRules={scan.appliedRules} />

          <div className="min-w-0 p-4">
            <h2 className="text-[0.875rem] font-semibold text-[var(--foreground)]">
              {t.forensics.findings}
            </h2>
            {scan.forensicReasons.length === 0 ? (
              <div className="mt-2 text-[0.78rem] text-[var(--muted)]">
                {t.forensics.noFindings}
              </div>
            ) : (
              <ul className="mt-2.5 divide-y divide-[var(--border-subtle)] rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface-1)]">
                {scan.forensicReasons.map((reason) => (
                  <li
                    key={reason}
                    className="flex items-start gap-2 px-3 py-2.5 text-[0.78rem] leading-snug text-[var(--foreground)]"
                  >
                    <span
                      className="mt-0.5 shrink-0 text-[var(--verdict-critical)]"
                      aria-hidden="true"
                    >
                      <IconOctagonAlert size={13} />
                    </span>
                    <span className="min-w-0 flex-1">{reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
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
    router.replace(buildPanelHref('beranda'), { scroll: false });
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
        <h1 id="vk-main-heading" tabIndex={-1} className="visually-hidden">
          {t.forensics.title}
        </h1>
        <div
          data-ui="console-workspace"
          className="flex flex-1 items-center justify-center gap-3 p-8 text-[0.875rem] text-[var(--muted-strong)]"
        >
          <span
            aria-hidden="true"
            className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--accent)]"
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

  return (
    <section className="vk-panel-section">
      <h1 id="vk-main-heading" tabIndex={-1} className="visually-hidden">
        {t.forensics.title}
      </h1>

      <div
        data-ui="console-workspace"
        className="flex flex-1 flex-col items-center justify-center bg-[var(--surface-2)] p-6 text-center"
      >
        <div className="vk-card max-w-md p-7">
          <h2 className="text-[1rem] font-semibold text-[var(--foreground)]">
            {t.forensics.notFound}
          </h2>
          <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-[var(--muted)]">
            {asyncLookup?.outcome === 'error' ? asyncLookup.message : t.forensics.notFoundHint}
          </p>
          <a
            href={buildPanelHref('beranda')}
            onClick={goScan}
            className="vk-btn vk-btn-primary mt-4 h-9 px-4 text-[0.8125rem] no-underline"
          >
            <IconScan size={14} />
            <span>{t.forensics.goToScan}</span>
          </a>
        </div>
      </div>
    </section>
  );
}
