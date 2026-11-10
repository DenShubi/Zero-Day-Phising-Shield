'use client';

/**
 * Beranda - the panel that absorbed the old "Pindai" and "Riwayat" tabs.
 *
 *   scan composer  ->  verdict strip  ->  history table | selected summary
 *
 * There is no page title here: the active nav tab already says "Beranda", and
 * the strip, the table header and the inspector each label themselves.
 */

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { VerdictTrend } from '@/components/charts/VerdictTrend';
import { IncidentFeed } from '@/components/feed/IncidentFeed';
import { ScanOmnibar } from '@/components/sandbox/ScanOmnibar';
import { ScoreBreakdownPanel } from '@/components/ui/ScoreBreakdown';
import { VerdictBadge } from '@/components/ui/VerdictBadge';
import { IconArrowRight, IconMitigation, IconOctagonAlert } from '@/components/ui/icons';
import { defang, describeTarget, formatWib } from '@/lib/format';
import { id } from '@/lib/i18n/id';
import type { NormalizedScan } from '@/lib/normalize';
import { buildPanelHref } from '@/lib/panel-route';
import type { FeedStatus } from '@/lib/supabase/useIncidentFeed';
import type { Verdict } from '@/lib/verdict';

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

/**
 * One row of the verdict meter list: a name, a bar on a shared baseline, and
 * the figure. Three ratios against the same whole read faster stacked like
 * this than as four separate tiles, and the bars line up so the mix is
 * comparable at a glance.
 */
function MeterRow({
  label,
  value,
  total,
  ink,
  fill,
}: {
  label: string;
  value: number;
  total: number;
  /** Verdict text token: carries the figure, tuned for 4.5:1. */
  ink: string;
  /** Verdict chart token: carries the bar, tuned as a mark. */
  fill: string;
}) {
  const share = total > 0 ? Math.round((value / total) * 100) : 0;

  return (
    <li className="flex items-center gap-2.5">
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span
          aria-hidden="true"
          className="h-2 w-2 shrink-0 rounded-[2px]"
          style={{ background: fill }}
        />
        <span className="truncate text-[0.8125rem] text-[var(--muted-strong)]">{label}</span>
      </span>

      <span
        aria-hidden="true"
        className="hidden h-1.5 w-16 shrink-0 overflow-hidden rounded-[var(--r-pill)] bg-[var(--surface-3)] min-[420px]:block lg:w-20 xl:w-24"
      >
        <span
          className="block h-full rounded-[var(--r-pill)] transition-[width] duration-300"
          style={{ width: `${value > 0 ? Math.max(4, share) : 0}%`, background: fill }}
        />
      </span>

      {/* Two fixed columns, not one right-aligned run: sharing a box let the
          count's right edge drift with the width of the percentage beside it,
          so "7 14%" and "42 84%" never lined up down the list. */}
      <span
        className="vk-tabular w-7 shrink-0 text-right text-[0.875rem] font-semibold tracking-[-0.01em]"
        style={{ color: ink }}
      >
        {value}
      </span>
      <span className="vk-tabular w-9 shrink-0 text-right text-[0.72rem] text-[var(--muted)]">
        {share}%
      </span>
    </li>
  );
}

export function OverviewPanel({
  incidents,
  status,
  lastEventAt,
  error,
  onRefresh,
  onOpenIncident,
  onScanComplete,
}: {
  incidents: readonly NormalizedScan[];
  status: FeedStatus;
  lastEventAt: number | null;
  error: string | null;
  onRefresh: () => void;
  onOpenIncident?: (incidentId: string) => void;
  onScanComplete?: (scan: NormalizedScan) => void;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const inspectorRef = useRef<HTMLElement>(null);

  const counts = useMemo(() => {
    const tally: Record<Verdict, number> = {
      CRITICAL_PHISHING: 0,
      SUSPICIOUS: 0,
      SAFE: 0,
    };
    for (const item of incidents) tally[item.verdict] += 1;
    return tally;
  }, [incidents]);

  const selectedIncident = useMemo(() => {
    if (incidents.length === 0) return null;
    if (selectedId) {
      const found = incidents.find((i) => (i.incidentId ?? i.scanId) === selectedId);
      if (found) return found;
    }
    return incidents.find((i) => i.verdict === 'CRITICAL_PHISHING') ?? incidents[0] ?? null;
  }, [incidents, selectedId]);

  const activeIncidentId = selectedIncident
    ? (selectedIncident.incidentId ?? selectedIncident.scanId)
    : null;

  const selectedHost = selectedIncident
    ? extractHost(selectedIncident.finalUrl ?? selectedIncident.submittedUrl)
    : null;

  const previewImg = selectedIncident
    ? (selectedIncident.annotatedUrl ?? selectedIncident.screenshotUrl)
    : null;

  return (
    <section className="vk-panel-section">
      <h1 id="vk-main-heading" tabIndex={-1} className="visually-hidden">
        {id.command.pageTitle}
      </h1>

      <ScanOmnibar onScanComplete={onScanComplete} />

      {/* Pita status: angka di kiri, tren harian di kanan. Keduanya membaca
          data yang sama, jadi tidak ada kalimat yang mengulang angkanya. */}
      <div className="grid shrink-0 border-b border-[var(--border)] bg-[var(--surface-1)] md:grid-cols-12">
        <div className="flex min-w-0 flex-col justify-center gap-3 px-4 py-4 sm:px-5 md:col-span-5 lg:col-span-4">
          <div>
            <span className="vk-pane-label">{id.command.statTotal}</span>
            <div className="vk-hero mt-0.5">{incidents.length}</div>
          </div>

          <ul className="flex flex-col gap-2 border-t border-[var(--border-subtle)] pt-3">
            <MeterRow
              label={id.command.statCritical}
              value={counts.CRITICAL_PHISHING}
              total={incidents.length}
              ink="var(--verdict-critical)"
              fill="var(--chart-critical)"
            />
            <MeterRow
              label={id.command.statSuspicious}
              value={counts.SUSPICIOUS}
              total={incidents.length}
              ink="var(--verdict-suspicious)"
              fill="var(--chart-suspicious)"
            />
            <MeterRow
              label={id.command.statSafe}
              value={counts.SAFE}
              total={incidents.length}
              ink="var(--verdict-safe)"
              fill="var(--chart-safe)"
            />
          </ul>
        </div>

        <div className="min-w-0 border-t border-[var(--border)] md:col-span-7 md:border-t-0 md:border-l lg:col-span-8">
          <VerdictTrend incidents={incidents} />
        </div>
      </div>

      <div
        data-ui="console-workspace"
        className="grid min-h-0 flex-1 divide-y divide-[var(--border)] lg:grid-cols-12 lg:divide-x lg:divide-y-0"
      >
        <div className="flex min-h-0 min-w-0 flex-col lg:col-span-7">
          <IncidentFeed
            incidents={incidents}
            status={status}
            lastEventAt={lastEventAt}
            error={error}
            onRefresh={onRefresh}
            selectedId={activeIncidentId}
            onSelectIncident={(incId) => {
              setSelectedId(incId);
              if (typeof window !== 'undefined' && window.innerWidth < 1024) {
                requestAnimationFrame(() => {
                  inspectorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                });
              }
            }}
            onOpenIncident={onOpenIncident}
          />
        </div>

        <aside
          ref={inspectorRef}
          aria-label={id.command.inspectorTitle}
          className="vk-scroll flex min-h-0 min-w-0 flex-col overflow-y-auto bg-[var(--surface-2)] lg:col-span-5"
        >
          {!selectedIncident ? (
            <div className="flex flex-1 items-center justify-center p-8 text-center text-[0.8125rem] text-[var(--muted)]">
              {id.command.inspectorEmpty}
            </div>
          ) : (
            <div className="flex flex-col gap-3 p-4">
              <div className="vk-card overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
                  <div className="flex items-center gap-2">
                    <VerdictBadge verdict={selectedIncident.verdict} />
                    <span className="vk-mono text-[0.78rem] text-[var(--muted)]">
                      {selectedIncident.ticket ??
                        `#${(selectedIncident.incidentId ?? selectedIncident.scanId).slice(0, 8)}`}
                    </span>
                  </div>
                  <span className="vk-tabular text-[0.72rem] text-[var(--muted)]">
                    {formatWib(selectedIncident.createdAtIso)}
                  </span>
                </div>

                <div className="vk-mono px-4 pt-2 text-[0.8125rem] break-all text-[var(--foreground)]">
                  {defang(
                    cleanTarget(
                      selectedIncident.finalUrl ?? describeTarget(selectedIncident.submittedUrl),
                    ),
                  )}
                </div>

                {previewImg && (
                  <div className="mt-3 overflow-hidden border-t border-[var(--border-subtle)] bg-[var(--surface-3)]">
                    {/* eslint-disable-next-line @next/next/no-img-element -- runtime evidence host */}
                    <img
                      src={previewImg}
                      alt={id.forensics.evidenceAlt}
                      referrerPolicy="no-referrer"
                      className="block max-h-44 w-full object-cover object-top"
                    />
                  </div>
                )}

                <div className="flex flex-wrap gap-2 p-4">
                  <button
                    type="button"
                    onClick={() => {
                      const targetId = selectedIncident.incidentId ?? selectedIncident.scanId;
                      onOpenIncident?.(targetId);
                      router.replace(buildPanelHref('forensik', { insiden: targetId }), {
                        scroll: false,
                      });
                    }}
                    className="vk-btn vk-btn-primary h-9 flex-1 px-3 text-[0.8125rem]"
                  >
                    <span>{id.command.openFullForensics}</span>
                    <IconArrowRight size={13} />
                  </button>

                  {selectedHost && selectedIncident.verdict !== 'SAFE' && (
                    <button
                      type="button"
                      onClick={() =>
                        router.replace(
                          buildPanelHref('respons', { tab: 'blokir', host: selectedHost }),
                          { scroll: false },
                        )
                      }
                      className="vk-btn vk-btn-secondary h-9 px-3 text-[0.8125rem]"
                    >
                      <IconMitigation size={13} />
                      <span>{id.command.blockSelectedHost}</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="vk-card">
                <ScoreBreakdownPanel
                  scores={selectedIncident.scores}
                  appliedRules={selectedIncident.appliedRules}
                />
              </div>

              {selectedIncident.forensicReasons.length > 0 && (
                <div className="vk-card p-4">
                  <h3 className="vk-section-title">{id.forensics.findings}</h3>
                  <ul className="mt-2.5 flex flex-col gap-1.5">
                    {selectedIncident.forensicReasons.slice(0, 4).map((reason) => (
                      <li
                        key={reason}
                        className="flex items-start gap-2 rounded-[var(--r-md)] bg-[var(--surface-2)] px-3 py-2 text-[0.78rem] leading-snug text-[var(--muted-strong)]"
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
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
