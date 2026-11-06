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
      {/* Top Panel Title Row */}
      <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[1.5rem] leading-[1.25] font-semibold tracking-[-0.02em] text-[var(--foreground)]">
            {t.command.headline}
          </h1>
          <p className="mt-0.5 max-w-[66ch] text-[1rem] leading-[1.5] text-[var(--muted-strong)]">
            {t.command.subtitle}
          </p>
        </div>

        <button
          type="button"
          onClick={() => router.replace(buildPanelHref('pemindaian'), { scroll: false })}
          className="vk-btn vk-btn-primary h-9 shrink-0 px-3.5 text-[0.875rem] font-medium"
        >
          <IconScan size={16} />
          <span>{t.command.ctaLaunchScan}</span>
        </button>
      </div>

      {/* Asymmetric 12-Column Bento Stage */}
      <div
        data-ui="console-workspace"
        className="grid min-h-0 flex-1 gap-3.5 lg:grid-cols-12"
      >
        {/* Left 7 Columns: Dominant Critical Hero + Satellites + Stacked Bar + Unit Ranking */}
        <div className="flex min-h-0 min-w-0 flex-col gap-3.5 lg:col-span-7">
          {/* Row 1: Dominant Critical Hero + 4 Subordinate Satellite Metrics */}
          <div className="grid shrink-0 gap-3.5 xl:grid-cols-12">
            <div className="vk-bento flex min-w-0 flex-col justify-between border-l-2 border-l-[var(--verdict-critical)] p-4 xl:col-span-6">
              <div className="flex items-center gap-2 text-[var(--verdict-critical)]">
                <IconOctagonAlert size={17} />
                <h3 className="text-[1.125rem] leading-[1.35] font-semibold tracking-[-0.01em] text-[var(--foreground)]">
                  {t.command.criticalHeroLabel}
                </h3>
              </div>

              <div className="my-2 flex flex-wrap items-baseline justify-between gap-3">
                <span
                  className="vk-mono vk-tabular text-[4.25rem] leading-[0.95] font-bold tracking-[-0.04em]"
                  style={{ color: 'var(--verdict-critical)' }}
                >
                  {stats.counts.CRITICAL_PHISHING}
                </span>

                <a
                  href={inspectHref}
                  onClick={(e) => navigate(e, inspectHref)}
                  className="vk-btn vk-btn-secondary h-8 shrink-0 px-3 text-[0.8125rem] no-underline"
                >
                  <span>{t.command.openLatestForensics}</span>
                  <IconArrowRight size={14} />
                </a>
              </div>

              <div className="text-[0.8125rem] leading-snug text-[var(--muted-strong)]">
                {t.command.criticalHeroHint}
              </div>
            </div>

            {/* Satellite Metrics (Clearly subordinate 24px scale, zero clipping) */}
            <div className="grid min-w-0 grid-cols-2 gap-2.5 xl:col-span-6">
              <div className="vk-bento flex min-w-0 flex-col justify-between p-3">
                <span className="text-[0.8125rem] leading-tight text-[var(--muted)]">
                  {t.command.totalIncidents}
                </span>
                <span className="vk-mono vk-tabular mt-1.5 text-[1.5rem] leading-[1.1] font-semibold tracking-[-0.02em] text-[var(--foreground)]">
                  {stats.total}
                </span>
              </div>

              <div className="vk-bento flex min-w-0 flex-col justify-between p-3">
                <span className="inline-flex items-center gap-1.5 text-[0.8125rem] leading-tight text-[var(--muted)]">
                  <span className="shrink-0 text-[var(--verdict-suspicious)]">
                    <IconAlertTriangle size={13} />
                  </span>
                  <span>{t.command.suspiciousCount}</span>
                </span>
                <span
                  className="vk-mono vk-tabular mt-1.5 text-[1.5rem] leading-[1.1] font-semibold tracking-[-0.02em]"
                  style={{ color: 'var(--verdict-suspicious)' }}
                >
                  {stats.counts.SUSPICIOUS}
                </span>
              </div>

              <div className="vk-bento flex min-w-0 flex-col justify-between p-3">
                <span className="inline-flex items-center gap-1.5 text-[0.8125rem] leading-tight text-[var(--muted)]">
                  <span className="shrink-0 text-[var(--verdict-safe)]">
                    <IconShieldCheck size={13} />
                  </span>
                  <span>{t.command.safeCount}</span>
                </span>
                <span
                  className="vk-mono vk-tabular mt-1.5 text-[1.5rem] leading-[1.1] font-semibold tracking-[-0.02em]"
                  style={{ color: 'var(--verdict-safe)' }}
                >
                  {stats.counts.SAFE}
                </span>
              </div>

              <div className="vk-bento flex min-w-0 flex-col justify-between p-3">
                <span className="text-[0.8125rem] leading-tight text-[var(--muted)]">
                  {t.command.meanRisk}
                </span>
                <div className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                  <span className="vk-mono vk-tabular text-[1.5rem] leading-[1.1] font-semibold tracking-[-0.02em] text-[var(--foreground)]">
                    {formatScore(stats.meanScore)}
                  </span>
                  <span className="text-[0.75rem] text-[var(--muted)]">
                    {t.command.outOfHundred}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Row 2: Single Stacked Verdict Distribution Bar */}
          <div className="vk-bento min-w-0 shrink-0 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-[1.125rem] leading-[1.35] font-semibold tracking-[-0.01em] text-[var(--foreground)]">
                {t.command.verdictDistribution}
              </h3>
              <span className="text-[0.8125rem] text-[var(--muted)]">
                {t.command.verdictDistributionHint}
              </span>
            </div>

            {stats.total === 0 ? (
              <div className="mt-3 text-[0.875rem] text-[var(--muted)]">{t.feed.empty}</div>
            ) : (
              <>
                <div
                  role="img"
                  aria-label={t.command.verdictDistribution}
                  className="mt-3 flex h-3.5 w-full gap-[2px] overflow-hidden rounded-md bg-[var(--surface-3)]"
                >
                  {VERDICT_ORDER.map((v) => {
                    const count = stats.counts[v];
                    if (count === 0) return null;
                    const pct = (count / stats.total) * 100;
                    return (
                      <span
                        key={v}
                        className="block h-full transition-[width] duration-200"
                        style={{
                          width: `${pct}%`,
                          background: `var(${VERDICT_VAR[v]})`,
                        }}
                      />
                    );
                  })}
                </div>

                <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.8125rem]">
                  {VERDICT_ORDER.map((v) => {
                    const count = stats.counts[v];
                    const pct = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0;
                    const color = `var(${VERDICT_VAR[v]})`;
                    return (
                      <div key={v} className="inline-flex items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 font-medium" style={{ color }}>
                          <VerdictIcon verdict={v} size={13} />
                          <span>{VERDICT_LABEL[v]}</span>
                        </span>
                        <span className="vk-mono vk-tabular text-[var(--foreground)]">
                          {count} <span className="text-[var(--muted)]">({pct}%)</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* Row 3: Honest Reporter Unit Ranking + Prominent Unmapped Counter */}
          <div className="vk-bento flex min-h-0 min-w-0 flex-1 flex-col p-4">
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-[1.125rem] leading-[1.35] font-semibold tracking-[-0.01em] text-[var(--foreground)]">
                  {t.command.originTitle}
                </h3>
                <div className="flex flex-wrap items-center gap-3 text-[0.8125rem]">
                  <span className="text-[var(--muted-strong)]">
                    <span>{t.command.mappedUnits}: </span>
                    <strong className="vk-mono vk-tabular font-semibold text-[var(--foreground)]">
                      {stats.mapped}
                    </strong>
                  </span>
                  <span className="text-[var(--muted)]">
                    <span>{t.common.unmapped}: </span>
                    <strong className="vk-mono vk-tabular font-medium text-[var(--muted-strong)]">
                      {stats.unmapped}
                    </strong>
                  </span>
                </div>
              </div>
              <div className="text-[0.8125rem] leading-snug text-[var(--muted)]">
                {t.command.originSubtitle}
              </div>
            </div>

            <div className="vk-scroll mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
              {rankingRows.length === 0 ? (
                <div className="py-3 text-[0.875rem] text-[var(--muted)]">{t.feed.empty}</div>
              ) : (
                <ul className="flex flex-col gap-2">
                  {rankingRows.map((bucket) => {
                    const widthPct = Math.max(4, (bucket.count / maxBucketCount) * 100);
                    return (
                      <li
                        key={bucket.key}
                        className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-2"
                      >
                        <div className="flex items-center justify-between gap-2 text-[0.8125rem]">
                          <span
                            className={
                              bucket.isUnmapped
                                ? 'font-medium text-[var(--muted-strong)]'
                                : 'font-medium text-[var(--foreground)]'
                            }
                          >
                            {bucket.label}
                          </span>
                          <span className="vk-mono vk-tabular shrink-0 text-[var(--foreground)]">
                            {bucket.count}{' '}
                            <span className="text-[var(--muted)]">{t.command.reportsSuffix}</span>
                          </span>
                        </div>
                        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--surface-3)]">
                          <span
                            className="block h-full rounded-full transition-[width] duration-200"
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
                <div className="mt-2.5 text-[0.8125rem] text-[var(--muted)]">
                  {t.command.noMappedUnits}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right 5 Columns: Live Incident Feed with Internal Scroll */}
        <div className="flex min-h-0 min-w-0 flex-col lg:col-span-5">
          <IncidentFeed
            incidents={incidents}
            status={feedStatus}
            lastEventAt={lastEventAt}
            error={feedError}
            onRefresh={onRefreshFeed}
          />
        </div>
      </div>
    </section>
  );
}
