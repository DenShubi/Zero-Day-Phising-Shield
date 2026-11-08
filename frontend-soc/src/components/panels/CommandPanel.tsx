'use client';

/**
 * Halaman Riwayat Pemindaian:
 * - Tabel riwayat hasil pemindaian di kiri (7 kolom)
 * - Ringkasan temuan & tangkapan layar untuk baris terpilih di kanan (5 kolom)
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IncidentFeed } from '@/components/feed/IncidentFeed';
import { ScoreBreakdownPanel } from '@/components/ui/ScoreBreakdown';
import { VerdictBadge } from '@/components/ui/VerdictBadge';
import {
  IconArrowRight,
  IconMitigation,
  IconOctagonAlert,
  IconScan,
} from '@/components/ui/icons';
import { defang, describeTarget, formatForensicTimestamp } from '@/lib/format';
import { id } from '@/lib/i18n/id';
import type { NormalizedScan } from '@/lib/normalize';
import { buildPanelHref } from '@/lib/panel-route';
import type { FeedStatus } from '@/lib/supabase/useIncidentFeed';

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

export function CommandPanel({
  incidents,
  status,
  lastEventAt,
  error,
  onRefresh,
  onOpenIncident,
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
      {/* Header Halaman */}
      <header className="vk-page-header">
        <div>
          <h1
            id="vk-main-heading"
            tabIndex={-1}
            className="text-[1.125rem] leading-[1.25] font-semibold tracking-[-0.02em] text-[var(--foreground)] outline-none sm:text-[1.25rem]"
          >
            {id.command.headline}
          </h1>
          <p className="mt-0.5 text-[0.78rem] text-[var(--muted)]">{id.command.subtitle}</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => router.replace(buildPanelHref('mitigasi'), { scroll: false })}
            className="vk-btn vk-btn-secondary h-8 shrink-0 px-3 text-[0.78rem]"
          >
            <IconMitigation size={14} />
            <span>{id.command.ctaExportRpz}</span>
          </button>
          <button
            type="button"
            onClick={() => router.replace(buildPanelHref('pemindaian'), { scroll: false })}
            className="vk-btn vk-btn-primary h-8 shrink-0 px-3.5 text-[0.78rem]"
          >
            <IconScan size={14} />
            <span>{id.command.ctaLaunchScan}</span>
          </button>
        </div>
      </header>

      {/* 2-Kolom Utama: Tabel Riwayat (7 Kolom) | Ringkasan Temuan (5 Kolom) */}
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
          className="vk-scroll flex min-h-0 min-w-0 flex-col divide-y divide-[var(--border)] overflow-y-auto bg-[var(--surface-0)] lg:col-span-5"
        >
          {!selectedIncident ? (
            <div className="p-6 text-[0.8125rem] text-[var(--muted)]">
              {id.command.inspectorEmpty}
            </div>
          ) : (
            <>
              <div className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="vk-mono text-[0.8125rem] font-semibold text-[var(--accent-ink)]">
                      {selectedIncident.ticket ??
                        `#${(selectedIncident.incidentId ?? selectedIncident.scanId).slice(0, 8)}`}
                    </span>
                    <VerdictBadge verdict={selectedIncident.verdict} size="sm" />
                  </div>
                  <span className="vk-mono text-[0.72rem] text-[var(--muted)]">
                    {formatForensicTimestamp(selectedIncident.createdAtIso)}
                  </span>
                </div>

                <div className="vk-mono mt-1.5 break-all text-[0.78rem] text-[var(--foreground)]">
                  {defang(
                    cleanTarget(
                      selectedIncident.finalUrl ?? describeTarget(selectedIncident.submittedUrl),
                    ),
                  )}
                </div>

                {previewImg && (
                  <div className="mt-3 overflow-hidden rounded-[4px] border border-[var(--border-strong)] bg-[var(--canvas)]">
                    {/* eslint-disable-next-line @next/next/no-img-element -- runtime evidence host */}
                    <img
                      src={previewImg}
                      alt={id.forensics.evidenceAlt}
                      referrerPolicy="no-referrer"
                      className="block max-h-48 w-full object-cover object-top"
                    />
                  </div>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const targetId = selectedIncident.incidentId ?? selectedIncident.scanId;
                      onOpenIncident?.(targetId);
                      router.replace(buildPanelHref('forensik', { insiden: targetId }), {
                        scroll: false,
                      });
                    }}
                    className="vk-btn vk-btn-primary h-8 flex-1 px-3 text-[0.78rem]"
                  >
                    <span>{id.command.openFullForensics}</span>
                    <IconArrowRight size={13} />
                  </button>

                  {selectedHost && selectedIncident.verdict !== 'SAFE' && (
                    <button
                      type="button"
                      onClick={() =>
                        router.replace(buildPanelHref('mitigasi', { host: selectedHost }), {
                          scroll: false,
                        })
                      }
                      className="vk-btn vk-btn-secondary h-8 px-3 text-[0.78rem]"
                    >
                      <IconMitigation size={13} />
                      <span>{id.command.blockSelectedHost}</span>
                    </button>
                  )}
                </div>
              </div>

              <ScoreBreakdownPanel
                scores={selectedIncident.scores}
                appliedRules={selectedIncident.appliedRules}
              />

              {selectedIncident.forensicReasons.length > 0 && (
                <div className="p-4">
                  <h3 className="text-[0.8125rem] font-semibold text-[var(--foreground)]">
                    {id.forensics.findings}
                  </h3>
                  <ul className="mt-2 divide-y divide-[var(--border-subtle)] rounded-[4px] border border-[var(--border)] bg-[var(--surface-1)]">
                    {selectedIncident.forensicReasons.slice(0, 4).map((reason) => (
                      <li
                        key={reason}
                        className="flex items-start gap-2 px-3 py-2 text-[0.78rem] leading-snug text-[var(--foreground)]"
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
            </>
          )}
        </aside>
      </div>
    </section>
  );
}
