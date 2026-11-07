'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type MouseEvent,
} from 'react';
import { useRouter } from 'next/navigation';
import type { NormalizedScan } from '@/lib/normalize';
import { describeTarget, formatAge, formatScore, truncateMiddle } from '@/lib/format';
import { id } from '@/lib/i18n/id';
import { buildPanelHref } from '@/lib/panel-route';
import type { FeedStatus } from '@/lib/supabase/useIncidentFeed';
import type { Verdict } from '@/lib/verdict';
import { VerdictBadge } from '@/components/ui/VerdictBadge';
import { IconArrowRight, IconOctagonAlert, IconRefresh } from '@/components/ui/icons';

type FilterValue = 'ALL' | Verdict;

function sanitizeTargetLabel(raw: string): string {
  const normalized = raw.startsWith('[IMAGE]')
    ? raw.replace(/^\[IMAGE\]\s*/, `${id.feed.imagePrefix}: `)
    : raw;
  return normalized.replace(/\s*\u2014\s*/g, ': ');
}

/**
 * Calm connection indicator: communicates socket/history state clearly with a
 * steady 6px square signal indicator and explicit text.
 */
function StatusIndicator({
  status,
  lastEventAt,
  mounted,
}: {
  status: FeedStatus;
  lastEventAt: number | null;
  mounted: boolean;
}) {
  const map: Record<FeedStatus, { label: string; color: string }> = {
    connecting: { label: id.feed.connecting, color: 'var(--muted)' },
    live: { label: id.feed.live, color: 'var(--verdict-safe)' },
    reconnecting: { label: id.feed.reconnecting, color: 'var(--verdict-suspicious)' },
    offline: { label: id.feed.offline, color: 'var(--verdict-critical)' },
    unconfigured: { label: id.feed.historyOnly, color: 'var(--accent-ink)' },
  };
  const s = map[status];

  return (
    <span className="inline-flex items-center gap-1.5 text-[0.75rem] text-[var(--muted)]">
      <span
        aria-hidden="true"
        className="inline-block h-1.5 w-1.5 shrink-0 rounded-[1px]"
        style={{ background: s.color }}
      />
      <span>{s.label}</span>
      {mounted && lastEventAt !== null && status === 'live' && (
        <span className="vk-mono vk-tabular">
          · {id.feed.lastEventPrefix} {formatAge(lastEventAt)}
        </span>
      )}
    </span>
  );
}

export function IncidentFeed({
  incidents,
  status,
  lastEventAt,
  error,
  onRefresh,
  limit = 50,
  onOpenIncident,
}: {
  incidents: readonly NormalizedScan[];
  status: FeedStatus;
  lastEventAt: number | null;
  error: string | null;
  onRefresh: () => void;
  limit?: number;
  onOpenIncident?: (incidentId: string) => void;
}) {
  const router = useRouter();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
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

  const navigateIncident = useCallback(
    (href: string, targetId: string) => {
      onOpenIncident?.(targetId);
      router.replace(href, { scroll: false });
    },
    [router, onOpenIncident],
  );

  const handleAnchorClick = useCallback(
    (e: MouseEvent<HTMLAnchorElement>, href: string, targetId: string) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      navigateIncident(href, targetId);
    },
    [navigateIncident],
  );

  const handleRowClick = useCallback(
    (e: MouseEvent<HTMLTableRowElement>, href: string, targetId: string) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      const selection = window.getSelection();
      if (selection && selection.toString().length > 0) return;
      navigateIncident(href, targetId);
    },
    [navigateIncident],
  );

  const filterOptions: { key: FilterValue; label: string }[] = [
    { key: 'ALL', label: id.feed.filterAll },
    { key: 'CRITICAL_PHISHING', label: id.feed.filterCritical },
    { key: 'SUSPICIOUS', label: id.feed.filterSuspicious },
    { key: 'SAFE', label: id.feed.filterSafe },
  ];

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--surface-1)]">
      {/* Ruled Inventory Header & Filter Toolbar */}
      <div className="shrink-0 border-b border-[var(--border)] bg-[var(--surface-0)] px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <h2 className="text-[0.9375rem] font-semibold tracking-[-0.01em] text-[var(--foreground)]">
              {id.feed.title}
            </h2>
            <StatusIndicator status={status} lastEventAt={lastEventAt} mounted={mounted} />
          </div>

          <button
            type="button"
            onClick={onRefresh}
            className="vk-btn vk-btn-secondary h-7 px-2.5 text-[0.75rem]"
          >
            <IconRefresh size={13} />
            <span>{id.feed.refresh}</span>
          </button>
        </div>

        <div className="mt-2.5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex min-w-0 flex-1 items-center gap-1.5 sm:max-w-xs">
            <label htmlFor="vk-feed-search" className="visually-hidden">
              {id.feed.searchAria}
            </label>
            <input
              id="vk-feed-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={id.feed.searchPlaceholder}
              className="h-8 w-full min-w-0 rounded-[4px] border border-[var(--border-strong)] bg-[var(--surface-1)] px-2.5 text-[0.8125rem] text-[var(--foreground)] placeholder:text-[var(--muted)]"
            />
            {search.trim().length > 0 && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="vk-btn vk-btn-secondary h-8 shrink-0 px-2 text-[0.75rem]"
              >
                {id.feed.clearSearch}
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-1" role="group" aria-label={id.feed.title}>
            {filterOptions.map((opt) => {
              const active = filter === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setFilter(opt.key)}
                  aria-pressed={active}
                  className={[
                    'vk-btn h-8 px-2.5 text-[0.75rem]',
                    active
                      ? 'border border-[var(--accent-border)] bg-[var(--accent-tint)] font-semibold text-[var(--foreground)]'
                      : 'border border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted-strong)] hover:border-[var(--border-strong)]',
                  ].join(' ')}
                >
                  <span>{opt.label}</span>
                  <span className="vk-mono vk-tabular text-[var(--muted)]">{counts[opt.key]}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {status === 'unconfigured' && (
        <div className="shrink-0 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-1.5 text-[0.75rem] text-[var(--muted)]">
          {id.feed.unconfigured}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="flex shrink-0 items-start gap-2 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 text-[0.8125rem] text-[var(--foreground)]"
        >
          <span className="mt-0.5 shrink-0 text-[var(--verdict-critical)]" aria-hidden="true">
            <IconOctagonAlert size={14} />
          </span>
          <span>{error}</span>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="max-w-md rounded-[4px] border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3.5 text-center text-[0.8125rem] text-[var(--muted-strong)]">
            {id.feed.empty}
          </div>
        </div>
      ) : (
        <div
          role="region"
          aria-labelledby="vk-feed-caption"
          tabIndex={0}
          className="vk-scroll vk-table-region min-h-0 min-w-0 flex-1 overflow-auto"
        >
          <table className="vk-ledger-table w-full border-collapse text-left">
            <caption id="vk-feed-caption" className="visually-hidden">
              {id.feed.caption}
            </caption>
            <thead className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--surface-0)]">
              <tr>
                <th scope="col" className="vk-pane-label px-4 py-2.5">
                  {id.feed.colTarget}
                </th>
                <th scope="col" className="vk-pane-label px-3 py-2.5">
                  {id.feed.colVerdict}
                </th>
                <th scope="col" className="vk-pane-label px-3 py-2.5 text-right">
                  {id.feed.colScore}
                </th>
                <th scope="col" className="vk-pane-label px-3 py-2.5">
                  {id.feed.colOrigin}
                </th>
                <th scope="col" className="vk-pane-label px-4 py-2.5 text-right">
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
                const originText = `${incident.reporterUnit ?? id.common.unmapped}${
                  incident.reporterSource ? ` · ${incident.reporterSource}` : ''
                }`;
                const scoreColor =
                  incident.verdict === 'CRITICAL_PHISHING'
                    ? 'var(--verdict-critical)'
                    : incident.verdict === 'SUSPICIOUS'
                      ? 'var(--verdict-suspicious)'
                      : 'var(--foreground)';

                return (
                  <tr
                    key={incident.scanId}
                    onClick={(e) => handleRowClick(e, href, targetId)}
                    className="group cursor-pointer transition-colors duration-100 hover:bg-[var(--surface-2)]"
                  >
                    <td data-label={id.feed.colTarget} className="max-w-[22rem] px-4 py-2.5 align-middle">
                      <a
                        href={href}
                        onClick={(e) => handleAnchorClick(e, href, targetId)}
                        aria-label={`${id.feed.inspectRow}: ${rawTarget}`}
                        className="block min-w-0 text-[var(--foreground)] no-underline"
                      >
                        <div className="vk-mono truncate text-[0.8125rem] font-medium text-[var(--foreground)] group-hover:text-[var(--accent-ink)]">
                          {truncateMiddle(rawTarget, 48)}
                        </div>
                        {incident.ticket && (
                          <div className="vk-mono mt-0.5 text-[0.72rem] text-[var(--muted)]">
                            {incident.ticket}
                          </div>
                        )}
                      </a>
                    </td>

                    <td data-label={id.feed.colVerdict} className="whitespace-nowrap px-3 py-2.5 align-middle">
                      <VerdictBadge verdict={incident.verdict} size="sm" />
                    </td>

                    <td
                      data-label={id.feed.colScore}
                      className="vk-mono vk-tabular whitespace-nowrap px-3 py-2.5 text-right align-middle text-[0.875rem] font-semibold"
                      style={{ color: scoreColor }}
                    >
                      {formatScore(incident.scores.total)}
                    </td>

                    <td
                      data-label={id.feed.colOrigin}
                      className="max-w-[14rem] truncate px-3 py-2.5 align-middle text-[0.8125rem] text-[var(--muted-strong)]"
                    >
                      {truncateMiddle(originText, 34)}
                    </td>

                    <td
                      data-label={id.feed.colAge}
                      className="whitespace-nowrap px-4 py-2.5 text-right align-middle"
                    >
                      <span className="inline-flex items-center justify-end gap-1.5 text-[0.75rem] text-[var(--muted)]">
                        <span className="vk-mono vk-tabular">
                          {mounted ? formatAge(incident.createdAtMs) : '-'}
                        </span>
                        <span
                          aria-hidden="true"
                          className="text-[var(--muted)] transition-transform duration-100 group-hover:translate-x-0.5 group-hover:text-[var(--accent-ink)]"
                        >
                          <IconArrowRight size={13} />
                        </span>
                      </span>
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
