'use client';

/**
 * Scans per day for the last two weeks, stacked by verdict.
 *
 * Form: the job is "see the split change over time", which is a stacked column
 * chart. The three verdicts are a status palette, so identity never rests on
 * colour alone - the legend carries each verdict's icon and name, the hover
 * card names every series, and a table view underneath holds every number for
 * screen readers and for anyone not using a pointer.
 *
 * Marks follow the house specs: columns capped at 24px, a 4px radius on the
 * data end only, square at the baseline, a 2px surface gap between stacked
 * segments, and hairline gridlines a step off the surface.
 *
 * Hydration: day buckets are anchored to "today", which the server and the
 * client disagree about. That is safe here because the feed is client-only -
 * both sides render the dateless empty state, and real buckets only ever
 * appear after mount.
 */

import { useMemo, useState } from 'react';
import { id as t } from '@/lib/i18n/id';
import type { NormalizedScan } from '@/lib/normalize';
import { VERDICT_LABEL, type Verdict } from '@/lib/verdict';
import { VerdictIcon } from '@/components/ui/icons';

const DAYS = 14;
/** Plot height in px; the bar maths and both axis gutters key off this. */
const PLOT_H = 136;
const DAY_MS = 86_400_000;
/** Buckets follow Jakarta days, like every other timestamp in the console. */
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Bottom to top. Validated in this order: the adjacent pairs are what a
 *  stacked column actually puts side by side. */
const SERIES: readonly { verdict: Verdict; fill: string }[] = [
  { verdict: 'SAFE', fill: 'var(--chart-safe)' },
  { verdict: 'SUSPICIOUS', fill: 'var(--chart-suspicious)' },
  { verdict: 'CRITICAL_PHISHING', fill: 'var(--chart-critical)' },
] as const;

const dayIndex = (ms: number) => Math.floor((ms + WIB_OFFSET_MS) / DAY_MS);
const dayStartMs = (index: number) => index * DAY_MS - WIB_OFFSET_MS;

const shortDay = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta',
  day: 'numeric',
  month: 'short',
});

const longDay = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

interface Bucket {
  index: number;
  label: string;
  fullLabel: string;
  counts: Record<Verdict, number>;
  total: number;
}

/** Round the axis top up to 1 / 2 / 5 x 10^n so the ticks are clean. */
function niceMax(value: number): number {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    const candidate = step * magnitude;
    if (candidate >= value) return Math.ceil(candidate);
  }
  return Math.ceil(value);
}

function EmptyPlot() {
  return (
    <div className="relative" style={{ height: PLOT_H }} aria-hidden="true">
      {[0, 50, 100].map((top) => (
        <span
          key={top}
          className="absolute inset-x-0 h-px bg-[var(--border)]"
          style={{ top: `${top}%` }}
        />
      ))}
      <span className="absolute inset-0 grid place-items-center text-[0.78rem] text-[var(--muted)]">
        {t.chart.empty}
      </span>
    </div>
  );
}

export function VerdictTrend({ incidents }: { incidents: readonly NormalizedScan[] }) {
  const [hovered, setHovered] = useState<number | null>(null);

  const buckets = useMemo<Bucket[]>(() => {
    if (incidents.length === 0) return [];

    // Anchored on the newest scan rather than on "now": render must stay pure,
    // and the header prints the span it actually covers, so a quiet stretch
    // shows up as old dates on the axis instead of a window that silently lies.
    const last = incidents.reduce(
      (newest, i) => Math.max(newest, dayIndex(i.createdAtMs)),
      dayIndex(incidents[0].createdAtMs),
    );
    const first = last - (DAYS - 1);

    const empty = (): Record<Verdict, number> => ({
      SAFE: 0,
      SUSPICIOUS: 0,
      CRITICAL_PHISHING: 0,
    });

    const slots = new Map<number, Record<Verdict, number>>();
    for (let i = first; i <= last; i += 1) slots.set(i, empty());

    for (const incident of incidents) {
      const slot = slots.get(dayIndex(incident.createdAtMs));
      if (slot) slot[incident.verdict] += 1;
    }

    return [...slots.entries()].map(([index, counts]) => {
      const at = dayStartMs(index);
      return {
        index,
        label: shortDay.format(at),
        fullLabel: longDay.format(at),
        counts,
        total: counts.SAFE + counts.SUSPICIOUS + counts.CRITICAL_PHISHING,
      };
    });
  }, [incidents]);

  const axisMax = useMemo(
    () => niceMax(buckets.reduce((max, b) => Math.max(max, b.total), 0)),
    [buckets],
  );

  const hasData = buckets.some((b) => b.total > 0);
  const hoveredPosition = buckets.findIndex((b) => b.index === hovered);
  const hoveredBucket = hoveredPosition >= 0 ? buckets[hoveredPosition] : null;

  return (
    <section
      aria-label={t.chart.title}
      className="flex min-w-0 flex-col gap-3 px-4 py-3 sm:px-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="vk-section-title">
          {t.chart.title}{' '}
          <span className="text-[0.78rem] font-normal text-[var(--muted)]">
            {buckets.length > 0
              ? `${buckets[0].label} – ${buckets[buckets.length - 1].label}`
              : t.chart.range}
          </span>
        </h2>

        {/* Legend: always present for >= 2 series, and the icon means identity
            never rests on the fill colour. */}
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {[...SERIES].reverse().map(({ verdict, fill }) => (
            <li
              key={verdict}
              className="inline-flex items-center gap-1.5 text-[0.72rem] text-[var(--muted-strong)]"
            >
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-[2px]"
                style={{ background: fill }}
              />
              <span className="shrink-0 text-[var(--muted)]">
                <VerdictIcon verdict={verdict} size={11} />
              </span>
              <span>{VERDICT_LABEL[verdict]}</span>
            </li>
          ))}
        </ul>
      </div>

      {!hasData ? (
        <EmptyPlot />
      ) : (
        <div className="flex min-w-0 gap-2">
          {/* Y axis: the ticks carry the values the marks are not labelled with. */}
          <div
            aria-hidden="true"
            style={{ height: PLOT_H }}
            className="vk-tabular flex w-6 shrink-0 flex-col justify-between text-right text-[0.6875rem] text-[var(--muted)]"
          >
            <span>{axisMax}</span>
            <span>{axisMax / 2}</span>
            <span>0</span>
          </div>

          <div className="relative min-w-0 flex-1">
            <div className="relative" style={{ height: PLOT_H }} aria-hidden="true">
              {[0, 50, 100].map((top) => (
                <span
                  key={top}
                  className="absolute inset-x-0 h-px bg-[var(--border)]"
                  style={{ top: `${top}%` }}
                />
              ))}

              <div
                className="absolute inset-0 flex items-end gap-[3px]"
                onPointerLeave={() => setHovered(null)}
              >
                {buckets.map((bucket) => {
                  const isHovered = hovered === bucket.index;
                  // Top-down, zero-count series dropped: index 0 is the mark
                  // that carries the stack's rounded data end.
                  const stack = [...SERIES]
                    .reverse()
                    .filter((s) => bucket.counts[s.verdict] > 0);
                  return (
                    <div
                      key={bucket.index}
                      onPointerEnter={() => setHovered(bucket.index)}
                      className="group relative flex h-full min-w-0 flex-1 cursor-default flex-col justify-end"
                    >
                      {/* Faint slot track, below gridline weight: rhythm, not data. */}
                      <span
                        className="absolute inset-x-0 inset-y-0 rounded-[4px] transition-colors duration-150"
                        style={{
                          background: isHovered ? 'var(--surface-2)' : 'transparent',
                        }}
                      />

                      <div className="relative mx-auto flex w-full max-w-[22px] flex-col justify-end gap-[2px]">
                        {stack.map(({ verdict, fill }, depth) => (
                          <span
                            key={verdict}
                            className={depth === 0 ? 'rounded-t-[4px]' : undefined}
                            style={{
                              height: `${Math.max(3, (bucket.counts[verdict] / axisMax) * PLOT_H)}px`,
                              background: fill,
                              opacity: hovered !== null && !isHovered ? 0.55 : 1,
                              transition: 'opacity 150ms ease-out',
                            }}
                          />
                        ))}
                      </div>

                    </div>
                  );
                })}
              </div>

              {/* One card for the hovered day, kept inside the plot box so it
                  never escapes over the composer above. Values lead, names
                  follow - the reader already knows which day they aimed at. */}
              {hoveredBucket && (
                <div
                  className={[
                    'pointer-events-none absolute top-1 z-20 w-max',
                    'vk-card px-3 py-2 shadow-[var(--shadow-md)]',
                    hoveredPosition < buckets.length / 2 ? 'right-1' : 'left-1',
                  ].join(' ')}
                >
                  <div className="text-[0.72rem] font-medium text-[var(--muted)]">
                    {hoveredBucket.fullLabel}
                  </div>
                  <ul className="mt-1.5 flex flex-col gap-1">
                    {[...SERIES].reverse().map(({ verdict, fill }) => (
                      <li
                        key={verdict}
                        className="flex items-center justify-between gap-5 text-[0.75rem] whitespace-nowrap"
                      >
                        <span className="inline-flex items-center gap-1.5 text-[var(--muted-strong)]">
                          <span
                            aria-hidden="true"
                            className="h-0.5 w-3 shrink-0 rounded-[1px]"
                            style={{ background: fill }}
                          />
                          {VERDICT_LABEL[verdict]}
                        </span>
                        <span className="vk-tabular font-semibold text-[var(--foreground)]">
                          {hoveredBucket.counts[verdict]}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* X axis: first, middle and last only - a label per column collides. */}
            <div
              aria-hidden="true"
              className="mt-1.5 flex justify-between text-[0.6875rem] text-[var(--muted)]"
            >
              <span>{buckets[0]?.label}</span>
              <span>{buckets[Math.floor(buckets.length / 2)]?.label}</span>
              <span>{buckets[buckets.length - 1]?.label}</span>
            </div>
          </div>
        </div>
      )}

      {/* Table view: every number the hover card shows, reachable without a
          pointer. The plot above is decoration as far as assistive tech is
          concerned. */}
      {hasData && (
        <table className="visually-hidden">
          <caption>{t.chart.tableCaption}</caption>
          <thead>
            <tr>
              <th scope="col">{t.chart.colDate}</th>
              {[...SERIES].reverse().map(({ verdict }) => (
                <th key={verdict} scope="col">
                  {VERDICT_LABEL[verdict]}
                </th>
              ))}
              <th scope="col">{t.chart.colTotal}</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((bucket) => (
              <tr key={bucket.index}>
                <th scope="row">{bucket.fullLabel}</th>
                {[...SERIES].reverse().map(({ verdict }) => (
                  <td key={verdict}>{bucket.counts[verdict]}</td>
                ))}
                <td>{bucket.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
