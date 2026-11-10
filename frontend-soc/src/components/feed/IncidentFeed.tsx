'use client';

import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { NormalizedScan } from '@/lib/normalize';
import { describeTarget, formatAge, formatScore, truncateMiddle } from '@/lib/format';
import { id } from '@/lib/i18n/id';
import { buildPanelHref } from '@/lib/panel-route';
import type { FeedStatus } from '@/lib/supabase/useIncidentFeed';
import type { Verdict } from '@/lib/verdict';
import { VerdictBadge } from '@/components/ui/VerdictBadge';
import { IconArrowRight, IconOctagonAlert, IconRefresh, IconSearch } from '@/components/ui/icons';

type FilterValue = 'ALL' | Verdict;

function sanitizeTargetLabel(raw: string): string {
  const normalized = raw.startsWith('[IMAGE]')
    ? raw.replace(/^\[IMAGE\]\s*/, `${id.feed.imagePrefix}: `)
    : raw;
  return normalized.replace(/\s*\u2014\s*/g, ': ');
}

/** First letter of the host, so each row has something to recognise it by. */
function targetInitial(label: string): string {
  const match = label.replace(/^https?:\/\//, '').match(/[a-z0-9]/i);
  return (match?.[0] ?? '?').toUpperCase();
}

export function IncidentFeed({
  incidents,
  error,
  onRefresh,
  limit = 60,
  selectedId,
  onSelectIncident,
  onOpenIncident,
}: {
  incidents: readonly NormalizedScan[];
  status?: FeedStatus;
  lastEventAt?: number | null;
  error: string | null;
  onRefresh: () => void;
  limit?: number;
  selectedId?: string | null;
  onSelectIncident?: (incidentId: string) => void;
  onOpenIncident?: (incidentId: string) => void;
}) {
  const router = useRouter();
  const [, setTick] = useState(0);
  const [filter, setFilter] = useState<FilterValue>('ALL');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 15_000);
    return () => clearInterval(timer);
  }, []);

  const counts = useMemo(() => {
    const c = { ALL: incidents.length, CRITICAL_PHISHING: 0, SUSPICIOUS: 0, SAFE: 0 };
    for (const item of incidents) c[item.verdict] += 1;
    return c;
  }, [incidents]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const base = incidents.filter((item) => {
      if (filter !== 'ALL' && item.verdict !== filter) return false;
      if (!needle) return true;
      const rawTarget = sanitizeTargetLabel(item.finalUrl ?? describeTarget(item.submittedUrl));
      const haystack = [
        rawTarget,
        item.submittedUrl,
        item.ticket ?? '',
        item.reporterUnit ?? '',
        item.reporterSource ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
    return base.slice(0, limit);
  }, [incidents, filter, search, limit]);

  const openFullForensics = useCallback(
    (e: MouseEvent<HTMLAnchorElement>, href: string, targetId: string) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      onOpenIncident?.(targetId);
      router.replace(href, { scroll: false });
    },
    [router, onOpenIncident],
  );

  const handleRowSelect = useCallback(
    (e: MouseEvent<HTMLTableRowElement>, href: string, targetId: string) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      const selection = window.getSelection();
      if (selection && selection.toString().length > 0) return;
      if (onSelectIncident) {
        onSelectIncident(targetId);
      } else {
        onOpenIncident?.(targetId);
        router.replace(href, { scroll: false });
      }
    },
    [onSelectIncident, onOpenIncident, router],
  );

  const filterOptions: { key: FilterValue; label: string }[] = [
    { key: 'ALL', label: id.feed.filterAll },
    { key: 'CRITICAL_PHISHING', label: id.feed.filterCritical },
    { key: 'SUSPICIOUS', label: id.feed.filterSuspicious },
    { key: 'SAFE', label: id.feed.filterSafe },
  ];

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--surface-1)]">
      <div className="shrink-0 px-4 pt-3.5 pb-2.5 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="vk-section-title">{id.command.recentTitle}</h2>

          <div className="flex w-full items-center gap-1.5 sm:w-auto">
            <div className="relative min-w-0 flex-1 sm:flex-initial">
              <label htmlFor="vk-feed-search" className="visually-hidden">
                {id.feed.searchAria}
              </label>
              <span
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[var(--muted)]"
              >
                <IconSearch size={13} />
              </span>
              <input
                id="vk-feed-search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={id.feed.searchPlaceholder}
                className="vk-input h-8 w-full rounded-[var(--r-pill)] pl-8 text-[0.78rem] sm:w-56"
              />
            </div>
            <button
              type="button"
              onClick={onRefresh}
              title={id.feed.refresh}
              aria-label={id.feed.refresh}
              className="vk-btn vk-btn-ghost h-8 w-8 shrink-0 p-0 text-[var(--muted)]"
            >
              <IconRefresh size={14} />
            </button>
          </div>
        </div>

        <div className="mt-2.5 flex flex-wrap gap-1.5" role="group" aria-label={id.feed.title}>
          {filterOptions.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setFilter(opt.key)}
              aria-pressed={filter === opt.key}
              className="vk-chip"
            >
              <span>{opt.label}</span>
              <span className="vk-chip-count">{counts[opt.key]}</span>
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mx-4 mb-2 flex shrink-0 items-start gap-2 rounded-[var(--r-md)] px-3 py-2 text-[0.78rem] text-[var(--muted-strong)] sm:mx-5"
          style={{ background: 'color-mix(in srgb, var(--verdict-critical) 9%, transparent)' }}
        >
          <span className="mt-0.5 shrink-0 text-[var(--verdict-critical)]" aria-hidden="true">
            <IconOctagonAlert size={14} />
          </span>
          <span>{error}</span>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center text-[0.8125rem] text-[var(--muted)]">
          {id.feed.empty}
        </div>
      ) : (
        <div
          role="region"
          aria-labelledby="vk-feed-caption"
          tabIndex={0}
          className="vk-scroll vk-table-region max-h-[26rem] min-h-0 min-w-0 flex-1 overflow-auto lg:max-h-none"
        >
          <table className="vk-ledger-table w-full border-collapse text-left">
            <caption id="vk-feed-caption" className="visually-hidden">
              {id.feed.caption}
            </caption>
            <thead className="sticky top-0 z-10 bg-[var(--surface-1)]">
              <tr className="border-b border-[var(--border)]">
                <th scope="col" className="vk-pane-label px-4 py-2 sm:px-5">
                  {id.feed.colTarget}
                </th>
                <th scope="col" className="vk-pane-label px-2.5 py-2">
                  {id.feed.colVerdict}
                </th>
                <th scope="col" className="vk-pane-label px-2.5 py-2 text-right">
                  {id.feed.colScore}
                </th>
                <th scope="col" className="vk-pane-label px-4 py-2 text-right sm:px-5">
                  {id.feed.colAge}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {filtered.map((incident) => {
                const rawTarget = sanitizeTargetLabel(
                  incident.finalUrl ?? describeTarget(incident.submittedUrl),
                );
                const targetId = incident.incidentId ?? incident.scanId;
                const href = buildPanelHref('forensik', { insiden: targetId });
                const isSelected = selectedId === targetId;
                const originText = incident.reporterUnit ?? id.common.unmapped;
                const scoreColor =
                  incident.verdict === 'CRITICAL_PHISHING'
                    ? 'var(--verdict-critical)'
                    : incident.verdict === 'SUSPICIOUS'
                      ? 'var(--verdict-suspicious)'
                      : 'var(--muted-strong)';

                return (
                  <tr
                    key={incident.scanId}
                    tabIndex={0}
                    aria-selected={isSelected}
                    onClick={(e) => handleRowSelect(e, href, targetId)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        if (onSelectIncident) {
                          onSelectIncident(targetId);
                        } else {
                          onOpenIncident?.(targetId);
                          router.replace(href, { scroll: false });
                        }
                      }
                    }}
                    className={[
                      'group cursor-pointer transition-colors duration-100',
                      isSelected
                        ? 'bg-[var(--accent-tint)]'
                        : 'hover:bg-[var(--surface-2)]',
                    ].join(' ')}
                  >
                    <td
                      data-label={id.feed.colTarget}
                      className="max-w-[24rem] px-4 py-2.5 align-middle sm:px-5"
                    >
                      <div className="flex items-center gap-2.5">
                        <span
                          aria-hidden="true"
                          className="grid h-7 w-7 shrink-0 place-items-center rounded-[var(--r-sm)] bg-[var(--surface-3)] text-[0.72rem] font-semibold text-[var(--muted-strong)]"
                        >
                          {targetInitial(rawTarget)}
                        </span>
                        <span className="min-w-0">
                          <span className="vk-mono block truncate text-[0.8125rem] font-medium text-[var(--foreground)]">
                            {truncateMiddle(rawTarget, 46)}
                          </span>
                          <span className="block truncate text-[0.72rem] text-[var(--muted)]">
                            {truncateMiddle(originText, 36)}
                          </span>
                        </span>
                      </div>
                    </td>

                    <td
                      data-label={id.feed.colVerdict}
                      className="whitespace-nowrap px-2.5 py-2.5 align-middle"
                    >
                      <VerdictBadge verdict={incident.verdict} size="sm" />
                    </td>

                    <td
                      data-label={id.feed.colScore}
                      className="vk-tabular px-2.5 py-2.5 text-right align-middle text-[0.875rem] font-semibold whitespace-nowrap"
                      style={{ color: scoreColor }}
                    >
                      {formatScore(incident.scores.total)}
                    </td>

                    <td
                      data-label={id.feed.colAge}
                      className="px-4 py-2.5 text-right align-middle whitespace-nowrap sm:px-5"
                    >
                      <div className="inline-flex items-center justify-end gap-1.5">
                        {/* Server and client compute this from their own
                            clocks; the text agrees except across a bucket
                            boundary, which is not worth a blank first paint. */}
                        <span
                          suppressHydrationWarning
                          className="vk-tabular text-[0.75rem] text-[var(--muted)]"
                        >
                          {formatAge(incident.createdAtMs)}
                        </span>
                        <a
                          href={href}
                          onClick={(e) => openFullForensics(e, href, targetId)}
                          aria-label={`${id.feed.inspectRow}: ${rawTarget}`}
                          title={id.feed.inspectRow}
                          className="vk-btn vk-btn-ghost h-7 w-7 p-0 text-[var(--muted)] no-underline opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100"
                        >
                          <IconArrowRight size={13} />
                        </a>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
