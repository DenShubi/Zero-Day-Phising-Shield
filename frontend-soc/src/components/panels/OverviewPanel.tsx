'use client';

/**
 * Beranda - the panel that absorbed the old "Pindai" and "Riwayat" tabs.
 *
 *   scan composer  ->  verdict strip  ->  history table | selected summary
 *
 * There is no page title here: the active nav tab already says "Beranda", and
 * the strip, the table header and the inspector each label themselves.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
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
  return raw.replace(/\s*—\s*/g, ': ');
}

/** One cell of the verdict strip: count, share bar, nothing else. */
function StatCell({
  label,
  value,
  total,
  color,
  segments,
}: {
  label: string;
  value: number;
  total: number;
  color?: string;
  /** Supplied for the total cell, where the bar shows the whole mix. */
  segments?: readonly { value: number; color: string }[];
}) {
  const share = total > 0 ? Math.round((value / total) * 100) : 0;

  return (
    <div className="flex min-w-0 flex-col gap-2 px-4 py-3 sm:px-5">
      <span className="vk-pane-label">{label}</span>
      <div className="flex items-baseline gap-2">
        <span className="vk-metric" style={color ? { color } : undefined}>
          {value}
        </span>
        {color && total > 0 && (
          <span className="vk-tabular text-[0.78rem] text-[var(--muted)]">{share}%</span>
        )}
      </div>

      <div
        className="flex h-1 gap-0.5 overflow-hidden rounded-[var(--r-pill)] bg-[var(--surface-3)]"
        aria-hidden="true"
      >
        {segments
          ? segments
              .filter((s) => s.value > 0)
              .map((s) => (
                <span
                  key={s.color}
                  className="h-full rounded-[var(--r-pill)]"
                  style={{
                    width: `${total > 0 ? (s.value / total) * 100 : 0}%`,
                    background: s.color,
                  }}
                />
              ))
          : total > 0 &&
            value > 0 && (
              <span
                className="h-full rounded-[var(--r-pill)] transition-[width] duration-300"
                style={{
                  width: `${Math.max(3, share)}%`,
                  background: color ?? 'var(--accent)',
                }}
              />
            )}
      </div>
    </div>
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

      {/* Pita status: angka saja, tanpa kalimat yang mengulang angkanya. */}
      <div className="grid shrink-0 grid-cols-2 border-b border-[var(--border)] bg-[var(--surface-1)] sm:grid-cols-4 sm:divide-x sm:divide-[var(--border-subtle)]">
        <StatCell
          label={id.command.statTotal}
          value={incidents.length}
          total={incidents.length}
          segments={[
            { value: counts.CRITICAL_PHISHING, color: 'var(--verdict-critical)' },
            { value: counts.SUSPICIOUS, color: 'var(--verdict-suspicious)' },
            { value: counts.SAFE, color: 'var(--verdict-safe)' },
          ]}
        />
        <StatCell
          label={id.command.statCritical}
          value={counts.CRITICAL_PHISHING}
          total={incidents.length}
          color="var(--verdict-critical)"
        />
        <StatCell
          label={id.command.statSuspicious}
          value={counts.SUSPICIOUS}
          total={incidents.length}
          color="var(--verdict-suspicious)"
        />
        <StatCell
          label={id.command.statSafe}
          value={counts.SAFE}
          total={incidents.length}
          color="var(--verdict-safe)"
        />
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
            onSelectIncident={(incId) => setSelectedId(incId)}
            onOpenIncident={onOpenIncident}
          />
        </div>

        <aside
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
