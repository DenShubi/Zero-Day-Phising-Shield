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
      {/* Filter & Pencarian */}
      <div className="shrink-0 border-b border-[var(--border)] bg-[var(--surface-0)] px-4 py-2.5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={id.feed.title}>
            {filterOptions.map((opt) => {
              const active = filter === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setFilter(opt.key)}
                  aria-pressed={active}
                  className={[
                    'vk-btn h-8 px-2.5 text-[0.78rem]',
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

          <div className="flex items-center gap-1.5">
            <label htmlFor="vk-feed-search" className="visually-hidden">
              {id.feed.searchAria}
            </label>
            <input
              id="vk-feed-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={id.feed.searchPlaceholder}
              className="h-8 w-full min-w-0 rounded-[4px] border border-[var(--border-strong)] bg-[var(--surface-1)] px-2.5 text-[0.78rem] text-[var(--foreground)] placeholder:text-[var(--muted)] sm:w-56"
            />
            {search.trim().length > 0 && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="vk-btn vk-btn-secondary h-8 shrink-0 px-2.5 text-[0.75rem]"
              >
                {id.feed.clearSearch}
              </button>
            )}
            <button
              type="button"
              onClick={onRefresh}
              title={id.feed.refresh}
              className="vk-btn vk-btn-secondary h-8 shrink-0 px-2.5 text-[0.75rem]"
            >
              <IconRefresh size={13} />
              <span className="hidden sm:inline">{id.feed.refresh}</span>
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="flex shrink-0 items-start gap-2 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 text-[0.78rem] text-[var(--foreground)]"
        >
          <span className="mt-0.5 shrink-0 text-[var(--verdict-critical)]" aria-hidden="true">
            <IconOctagonAlert size={14} />
          </span>
          <span>{error}</span>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="max-w-md rounded-[4px] border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 text-center text-[0.8125rem] text-[var(--muted-strong)]">
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
                <th scope="col" className="vk-pane-label px-3.5 py-2">
                  {id.common.ticket}
                </th>
                <th scope="col" className="vk-pane-label px-3.5 py-2">
                  {id.feed.colTarget}
                </th>
                <th scope="col" className="vk-pane-label px-2.5 py-2">
                  {id.feed.colVerdict}
                </th>
                <th scope="col" className="vk-pane-label px-2.5 py-2 text-right">
                  {id.feed.colScore}
                </th>
                <th scope="col" className="vk-pane-label px-3.5 py-2 text-right">
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
                      : 'var(--foreground)';

                return (
                  <tr
                    key={incident.scanId}
                    onClick={(e) => handleRowSelect(e, href, targetId)}
                    className={[
                      'group cursor-pointer transition-colors duration-100',
                      isSelected ? 'bg-[var(--accent-tint)]' : 'hover:bg-[var(--surface-2)]',
                    ].join(' ')}
                  >
                    <td
                      data-label={id.common.ticket}
                      className="vk-mono whitespace-nowrap px-3.5 py-2.5 align-middle text-[0.75rem] text-[var(--muted-strong)]"
                    >
                      <span
                        className={
                          isSelected ? 'font-semibold text-[var(--accent-ink)]' : undefined
                        }
                      >
                        {incident.ticket ?? targetId.slice(0, 8)}
                      </span>
                    </td>

                    <td
                      data-label={id.feed.colTarget}
                      className="max-w-[22rem] px-3.5 py-2.5 align-middle"
                    >
                      <div className="vk-mono truncate text-[0.8125rem] font-medium text-[var(--foreground)] group-hover:text-[var(--accent-ink)]">
                        {truncateMiddle(rawTarget, 48)}
                      </div>
                      <div className="truncate text-[0.72rem] text-[var(--muted)]">
                        {truncateMiddle(originText, 36)}
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
                      className="vk-mono vk-tabular whitespace-nowrap px-2.5 py-2.5 text-right align-middle text-[0.875rem] font-semibold"
                      style={{ color: scoreColor }}
                    >
                      {formatScore(incident.scores.total)}
                    </td>

                    <td
                      data-label={id.feed.colAge}
                      className="whitespace-nowrap px-3.5 py-2.5 text-right align-middle"
                    >
                      <div className="inline-flex items-center justify-end gap-2">
                        <span className="vk-mono vk-tabular text-[0.75rem] text-[var(--muted)]">
                          {mounted ? formatAge(incident.createdAtMs) : '-'}
                        </span>
                        <a
                          href={href}
                          onClick={(e) => openFullForensics(e, href, targetId)}
                          aria-label={`${id.feed.inspectRow}: ${rawTarget}`}
                          title={id.feed.inspectRow}
                          className="vk-btn vk-btn-secondary h-6 px-1.5 text-[0.6875rem] no-underline"
                        >
                          <IconArrowRight size={11} />
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
