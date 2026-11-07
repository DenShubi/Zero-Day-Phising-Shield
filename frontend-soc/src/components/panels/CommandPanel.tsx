'use client';

import { useMemo, type MouseEvent } from 'react';
import { useRouter } from 'next/navigation';
import { IncidentFeed } from '@/components/feed/IncidentFeed';
import { formatScore } from '@/lib/format';
import { id as t } from '@/lib/i18n/id';
import type { NormalizedScan } from '@/lib/normalize';
import { buildPanelHref } from '@/lib/panel-route';
import type { FeedStatus } from '@/lib/supabase/useIncidentFeed';
import { locateUnit } from '@/lib/units-geo';
import {
  VERDICT_LABEL,
  VERDICT_ORDER,
  VERDICT_VAR,
  type Verdict,
} from '@/lib/verdict';
import {
  IconAlertTriangle,
  IconArrowRight,
  IconMitigation,
  IconOctagonAlert,
  IconScan,
  IconShieldCheck,
  VerdictIcon,
} from '@/components/ui/icons';

interface UnitBucket {
  key: string;
  label: string;
  count: number;
  critical: number;
  isUnmapped?: boolean;
}

export function CommandPanel({
  incidents,
  feedStatus,
  lastEventAt,
  feedError,
  onRefreshFeed,
}: {
  incidents: readonly NormalizedScan[];
  feedStatus: FeedStatus;
  lastEventAt: number | null;
  feedError: string | null;
  onRefreshFeed: () => void;
}) {
  const router = useRouter();

  const stats = useMemo(() => {
    const counts: Record<Verdict, number> = {
      SAFE: 0,
      SUSPICIOUS: 0,
      CRITICAL_PHISHING: 0,
    };
    let scoreSum = 0;
    let mapped = 0;
    let latestCritical: NormalizedScan | null = null;
    const unitMap = new Map<string, UnitBucket>();

    for (const item of incidents) {
      counts[item.verdict] += 1;
      scoreSum += item.scores.total;
      if (item.verdict === 'CRITICAL_PHISHING' && !latestCritical) {
        latestCritical = item;
      }

      const loc = locateUnit(item.reporterUnit);
      if (loc) {
        mapped += 1;
        const prev = unitMap.get(loc.label) ?? {
          key: loc.label,
          label: loc.label,
          count: 0,
          critical: 0,
        };
        prev.count += 1;
        if (item.verdict === 'CRITICAL_PHISHING') prev.critical += 1;
        unitMap.set(loc.label, prev);
      }
    }

    const unmapped = incidents.length - mapped;
    const unitRanking = Array.from(unitMap.values()).sort((a, b) => b.count - a.count);

    return {
      counts,
      total: incidents.length,
      meanScore: incidents.length > 0 ? scoreSum / incidents.length : 0,
      mapped,
      unmapped,
      latestCritical,
      latestAny: incidents[0] ?? null,
      unitRanking,
    };
  }, [incidents]);

  const navigate = (e: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    router.replace(href, { scroll: false });
  };

  const inspectTarget = stats.latestCritical ?? stats.latestAny;
  const inspectHref = inspectTarget
    ? buildPanelHref('forensik', { insiden: inspectTarget.incidentId ?? inspectTarget.scanId })
    : buildPanelHref('pemindaian');
  const mitigationHref = buildPanelHref('mitigasi');

  const rankingRows: readonly UnitBucket[] = useMemo(() => {
    const rows: UnitBucket[] = [...stats.unitRanking];
    if (stats.unmapped > 0) {
      rows.push({
        key: '__unmapped__',
        label: `${t.common.unmapped} (${t.command.unmappedChannel})`,
        count: stats.unmapped,
        critical: 0,
        isUnmapped: true,
      });
    }
    return rows;
  }, [stats.unitRanking, stats.unmapped]);

  const maxBucketCount = useMemo(
    () => Math.max(1, ...rankingRows.map((r) => r.count)),
    [rankingRows],
  );

  return (
    <section className="vk-panel-section">
      {/* Flush Architectural Page Header */}
      <header className="vk-page-header">
        <div>
          <div className="vk-kicker">{t.command.sectionIndex}</div>
          <h1
            id="vk-main-heading"
            tabIndex={-1}
            className="mt-0.5 text-[1.25rem] leading-[1.25] font-semibold tracking-[-0.02em] text-[var(--foreground)] outline-none sm:text-[1.375rem]"
          >
            {t.command.headline}
          </h1>
          <p className="mt-0.5 max-w-[68ch] text-[0.8125rem] leading-[1.45] text-[var(--muted-strong)]">
            {t.command.subtitle}
          </p>
        </div>

        <button
          type="button"
          onClick={() => router.replace(buildPanelHref('pemindaian'), { scroll: false })}
          className="vk-btn vk-btn-primary h-9 shrink-0 px-3.5 text-[0.8125rem]"
        >
          <IconScan size={15} />
          <span>{t.command.ctaLaunchScan}</span>
        </button>
      </header>

      {/* Ruled Telemetry Strip (Dominant Critical Active + 4 Subordinate Cells) */}
      <div className="grid shrink-0 grid-cols-2 divide-x divide-y divide-[var(--border)] border-b border-[var(--border)] bg-[var(--surface-1)] lg:grid-cols-12 lg:divide-y-0">
        <div className="col-span-2 flex min-w-0 flex-col justify-between bg-[var(--surface-0)] px-4 py-3 lg:col-span-4">
          <div className="flex items-center justify-between gap-2">
            <span className="vk-pane-label inline-flex items-center gap-1.5 text-[var(--foreground)]">
              <span className="text-[var(--verdict-critical)]" aria-hidden="true">
                <IconOctagonAlert size={14} />
              </span>
              <span>{t.command.criticalHeroLabel}</span>
            </span>

            <a
              href={inspectHref}
              onClick={(e) => navigate(e, inspectHref)}
              className="vk-btn vk-btn-secondary h-7 shrink-0 px-2.5 text-[0.75rem] no-underline"
            >
              <span>{t.command.openLatestForensics}</span>
              <IconArrowRight size={13} />
            </a>
          </div>

          <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-2">
            <span
              className="vk-mono vk-tabular text-[2.375rem] leading-none font-bold tracking-[-0.04em]"
              style={{
                color:
                  stats.counts.CRITICAL_PHISHING > 0
                    ? 'var(--verdict-critical)'
                    : 'var(--foreground)',
              }}
            >
              {stats.counts.CRITICAL_PHISHING}
            </span>
            <span className="max-w-[30ch] text-right text-[0.75rem] leading-tight text-[var(--muted)]">
              {t.command.criticalHeroHint}
            </span>
          </div>
        </div>

        <div className="flex min-w-0 flex-col justify-between px-3.5 py-3 lg:col-span-2">
          <span className="vk-pane-label">{t.command.totalIncidents}</span>
          <span className="vk-mono vk-tabular mt-2 text-[1.5rem] leading-none font-semibold tracking-[-0.02em] text-[var(--foreground)]">
            {stats.total}
          </span>
        </div>

        <div className="flex min-w-0 flex-col justify-between px-3.5 py-3 lg:col-span-2">
          <span className="vk-pane-label inline-flex items-center gap-1.5">
            <span className="text-[var(--verdict-suspicious)]" aria-hidden="true">
              <IconAlertTriangle size={12} />
            </span>
            <span>{t.command.suspiciousCount}</span>
          </span>
          <span
            className="vk-mono vk-tabular mt-2 text-[1.5rem] leading-none font-semibold tracking-[-0.02em]"
            style={{
              color:
                stats.counts.SUSPICIOUS > 0
                  ? 'var(--verdict-suspicious)'
                  : 'var(--foreground)',
            }}
          >
            {stats.counts.SUSPICIOUS}
          </span>
        </div>

        <div className="flex min-w-0 flex-col justify-between px-3.5 py-3 lg:col-span-2">
          <span className="vk-pane-label inline-flex items-center gap-1.5">
            <span className="text-[var(--verdict-safe)]" aria-hidden="true">
              <IconShieldCheck size={12} />
            </span>
            <span>{t.command.safeCount}</span>
          </span>
          <span
            className="vk-mono vk-tabular mt-2 text-[1.5rem] leading-none font-semibold tracking-[-0.02em]"
            style={{
              color: stats.counts.SAFE > 0 ? 'var(--verdict-safe)' : 'var(--foreground)',
            }}
          >
            {stats.counts.SAFE}
          </span>
        </div>

        <div className="flex min-w-0 flex-col justify-between px-3.5 py-3 lg:col-span-2">
          <span className="vk-pane-label">{t.command.meanRisk}</span>
          <div className="mt-2 flex flex-wrap items-baseline gap-1">
            <span className="vk-mono vk-tabular text-[1.5rem] leading-none font-semibold tracking-[-0.02em] text-[var(--foreground)]">
              {formatScore(stats.meanScore)}
            </span>
            <span className="vk-mono text-[0.75rem] text-[var(--muted)]">
              {t.command.outOfHundred}
            </span>
          </div>
        </div>
      </div>

      {/* Main 12-Column Split Ledger: 8-Col Inventory Table + 4-Col Breakdown Rail */}
      <div
        data-ui="console-workspace"
        className="grid min-h-0 flex-1 divide-y divide-[var(--border)] lg:grid-cols-12 lg:divide-x lg:divide-y-0"
      >
        {/* Left 8 Columns: Endpoint & Incident Inventory Table */}
        <div className="flex min-h-0 min-w-0 flex-col lg:col-span-8">
          <IncidentFeed
            incidents={incidents}
            status={feedStatus}
            lastEventAt={lastEventAt}
            error={feedError}
            onRefresh={onRefreshFeed}
          />
        </div>

        {/* Right 4 Columns: Classification Proportion + Honest Reporter Unit Ledger */}
        <aside className="flex min-h-0 min-w-0 flex-col divide-y divide-[var(--border)] bg-[var(--surface-0)] lg:col-span-4">
          <div className="shrink-0 p-4">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="vk-pane-label text-[var(--foreground)]">
                {t.command.verdictDistribution}
              </h2>
              <a
                href={mitigationHref}
                onClick={(e) => navigate(e, mitigationHref)}
                className="inline-flex items-center gap-1 text-[0.75rem] font-medium text-[var(--accent-ink)] no-underline hover:underline"
              >
                <IconMitigation size={12} />
                <span>{t.command.openMitigation}</span>
              </a>
            </div>
            <p className="mt-0.5 text-[0.75rem] text-[var(--muted)]">
              {t.command.verdictDistributionHint}
            </p>

            {stats.total === 0 ? (
              <div className="mt-3 text-[0.8125rem] text-[var(--muted)]">{t.feed.empty}</div>
            ) : (
              <>
                <div
                  role="img"
                  aria-label={t.command.verdictDistribution}
                  className="mt-3 flex h-2.5 w-full gap-[2px] overflow-hidden rounded-[2px] bg-[var(--surface-3)]"
                >
                  {VERDICT_ORDER.map((v) => {
                    const count = stats.counts[v];
                    if (count === 0) return null;
                    const pct = (count / stats.total) * 100;
                    return (
                      <span
                        key={v}
                        className="block h-full transition-[width] duration-150"
                        style={{
                          width: `${pct}%`,
                          background: `var(${VERDICT_VAR[v]})`,
                        }}
                      />
                    );
                  })}
                </div>

                <div className="mt-3 divide-y divide-[var(--border-subtle)] rounded-[3px] border border-[var(--border)] bg-[var(--surface-1)]">
                  {VERDICT_ORDER.map((v) => {
                    const count = stats.counts[v];
                    const pct = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0;
                    const color = `var(${VERDICT_VAR[v]})`;
                    return (
                      <div
                        key={v}
                        className="flex items-center justify-between gap-2 px-3 py-1.5 text-[0.8125rem]"
                      >
                        <span className="inline-flex items-center gap-1.5 font-medium" style={{ color }}>
                          <VerdictIcon verdict={v} size={13} />
                          <span>{VERDICT_LABEL[v]}</span>
                        </span>
                        <span className="vk-mono vk-tabular text-[var(--foreground)]">
                          {count}{' '}
                          <span className="text-[0.75rem] text-[var(--muted)]">({pct}%)</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          <div className="flex min-h-0 flex-1 flex-col p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="vk-pane-label text-[var(--foreground)]">{t.command.originTitle}</h2>
              <div className="vk-mono vk-tabular flex items-center gap-2.5 text-[0.72rem] text-[var(--muted)]">
                <span>
                  {t.command.mappedUnits}:{' '}
                  <strong className="font-semibold text-[var(--foreground)]">{stats.mapped}</strong>
                </span>
                <span>
                  {t.common.unmapped}:{' '}
                  <strong className="font-semibold text-[var(--muted-strong)]">
                    {stats.unmapped}
                  </strong>
                </span>
              </div>
            </div>
            <p className="mt-0.5 text-[0.75rem] leading-snug text-[var(--muted)]">
              {t.command.originSubtitle}
            </p>

            <div className="vk-scroll mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
              {rankingRows.length === 0 ? (
                <div className="py-3 text-[0.8125rem] text-[var(--muted)]">{t.feed.empty}</div>
              ) : (
                <ul className="divide-y divide-[var(--border-subtle)] rounded-[3px] border border-[var(--border)] bg-[var(--surface-1)]">
                  {rankingRows.map((bucket) => {
                    const widthPct = Math.max(4, (bucket.count / maxBucketCount) * 100);
                    return (
                      <li key={bucket.key} className="px-3 py-2">
                        <div className="flex items-center justify-between gap-2 text-[0.8125rem]">
                          <span
                            className={
                              bucket.isUnmapped
                                ? 'truncate text-[var(--muted-strong)]'
                                : 'truncate font-medium text-[var(--foreground)]'
                            }
                          >
                            {bucket.label}
                          </span>
                          <span className="vk-mono vk-tabular shrink-0 text-[0.75rem] text-[var(--foreground)]">
                            {bucket.count}{' '}
                            <span className="text-[var(--muted)]">{t.command.reportsSuffix}</span>
                          </span>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-[1px] bg-[var(--surface-3)]">
                          <span
                            className="block h-full transition-[width] duration-150"
                            style={{
                              width: `${widthPct}%`,
                              background: bucket.isUnmapped
                                ? 'var(--muted)'
                                : bucket.critical > 0
                                  ? 'var(--verdict-critical)'
                                  : 'var(--accent-ink)',
                            }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              {stats.unitRanking.length === 0 && stats.total > 0 && (
                <div className="mt-2.5 text-[0.75rem] text-[var(--muted)]">
                  {t.command.noMappedUnits}
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
