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

/**
 * Calm connection indicator: communicates socket/history state clearly with a
 * steady status dot and explicit text — no flashy blinking "LIVE" badge.
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
    <span className="inline-flex items-center gap-1.5 text-[0.8125rem] text-[var(--muted)]">
      <span
        aria-hidden="true"
        className="inline-block h-2 w-2 shrink-0 rounded-full"
        style={{ background: s.color }}
      />
      <span>{s.label}</span>
      {mounted && lastEventAt !== null && status === 'live' && (
        <span>
          · {id.feed.lastEventPrefix} {formatAge(lastEventAt)}
        </span>
      )}
    </span>
  );
}

function FeedRow({
  incident,
  mounted,
  onSelect,
}: {
  incident: NormalizedScan;
  mounted: boolean;
  onSelect: (e: MouseEvent<HTMLAnchorElement>, href: string, targetId: string) => void;
}) {
  const rawTarget = incident.finalUrl ?? describeTarget(incident.submittedUrl);
  const target = rawTarget.startsWith('[IMAGE]')
    ? rawTarget.replace(/^\[IMAGE\]\s*/, 'Gambar (BERKAS) — ')
    : rawTarget;
  const targetId = incident.incidentId ?? incident.scanId;
  const href = buildPanelHref('forensik', { insiden: targetId });

  return (
    <li className="min-w-0 overflow-hidden">
      <a
        href={href}
        onClick={(e) => onSelect(e, href, targetId)}
        aria-label={`${id.feed.inspectRow}: ${target}`}
        className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 overflow-hidden rounded-lg border border-transparent px-3 py-2.5 no-underline transition-colors duration-150 hover:border-[var(--border)] hover:bg-[var(--surface-2)]"
      >
        <div className="min-w-0 overflow-hidden">
          <div className="flex flex-wrap items-center gap-2">
            <VerdictBadge verdict={incident.verdict} size="sm" />
            {incident.ticket && (
              <span className="vk-mono text-[0.8125rem] text-[var(--muted)]">{incident.ticket}</span>
            )}
          </div>
          <div className="vk-mono mt-1.5 truncate text-[0.875rem] text-[var(--foreground)]">
            <span className="xl:hidden">{truncateMiddle(target, 24)}</span>
            <span className="hidden xl:inline">{truncateMiddle(target, 46)}</span>
          </div>
          <div className="mt-0.5 truncate text-[0.8125rem] text-[var(--muted)]">
            <span className="xl:hidden">
              {truncateMiddle(
                `${incident.reporterUnit ?? id.common.unmapped}${incident.reporterSource ? ` · ${incident.reporterSource}` : ''}`,
                26,
              )}
            </span>
            <span className="hidden xl:inline">
              {incident.reporterUnit ?? id.common.unmapped}
              {incident.reporterSource && ` · ${incident.reporterSource}`}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2.5 text-right">
          <div>
            <div className="vk-mono vk-tabular text-[0.9375rem] font-semibold text-[var(--foreground)]">
              {formatScore(incident.scores.total)}
            </div>
            <div className="vk-tabular text-[0.8125rem] text-[var(--muted)]">
              {mounted ? formatAge(incident.createdAtMs) : '—'}
            </div>
          </div>
          <span className="text-[var(--muted)] transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-[var(--accent-ink)]">
            <IconArrowRight size={15} />
          </span>
        </div>
      </a>
    </li>
  );
}

export function IncidentFeed({
  incidents,
  status,
  lastEventAt,
  error,
  onRefresh,
  limit = 40,
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

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  const counts = useMemo(() => {
    const c = { ALL: incidents.length, CRITICAL_PHISHING: 0, SUSPICIOUS: 0, SAFE: 0 };
    for (const item of incidents) c[item.verdict] += 1;
    return c;
  }, [incidents]);

  const filtered = useMemo(() => {
    const base = filter === 'ALL' ? incidents : incidents.filter((i) => i.verdict === filter);
    return base.slice(0, limit);
  }, [incidents, filter, limit]);

  const handleRowClick = useCallback(
    (e: MouseEvent<HTMLAnchorElement>, href: string, targetId: string) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      onOpenIncident?.(targetId);
      router.replace(href, { scroll: false });
    },
    [router, onOpenIncident],
  );

  const filterOptions: { key: FilterValue; label: string }[] = [
    { key: 'ALL', label: id.feed.filterAll },
    { key: 'CRITICAL_PHISHING', label: id.feed.filterCritical },
    { key: 'SUSPICIOUS', label: id.feed.filterSuspicious },
    { key: 'SAFE', label: id.feed.filterSafe },
  ];

  return (
    <div className="vk-bento flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="border-b border-[var(--border-subtle)] px-4 py-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-[1.125rem] font-semibold tracking-[-0.01em] text-[var(--foreground)]">
              {id.feed.title}
            </h3>
            <div className="mt-0.5">
              <StatusIndicator status={status} lastEventAt={lastEventAt} mounted={mounted} />
            </div>
          </div>

          <button
            type="button"
            onClick={onRefresh}
            className="vk-btn vk-btn-secondary h-8 px-2.5 text-[0.8125rem]"
          >
            <IconRefresh size={14} />
            <span>{id.feed.refresh}</span>
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label={id.feed.title}>
          {filterOptions.map((opt) => {
            const active = filter === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => setFilter(opt.key)}
                aria-pressed={active}
                className={[
                  'vk-btn h-7 px-2.5 text-[0.8125rem]',
                  active
                    ? 'border border-[var(--accent-border)] bg-[var(--accent-tint)] text-[var(--foreground)]'
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

      {status === 'unconfigured' && (
        <div className="border-b border-[var(--border-subtle)] bg-[var(--surface-2)] px-4 py-2 text-[0.8125rem] text-[var(--muted)]">
          {id.feed.unconfigured}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 border-b border-[var(--border-subtle)] border-l-2 border-l-[var(--verdict-critical)] bg-[var(--surface-2)] px-4 py-2 text-[0.8125rem] text-[var(--foreground)]">
          <span className="mt-0.5 shrink-0 text-[var(--verdict-critical)]" aria-hidden="true">
            <IconOctagonAlert size={14} />
          </span>
          <span>{error}</span>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="flex flex-1 flex-col gap-2.5 p-3">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-4 text-[0.875rem] text-[var(--muted-strong)]">
            {id.feed.empty}
          </div>
          {[0, 1, 2, 3].map((slot) => (
            <div
              key={slot}
              aria-hidden="true"
              className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)]/45 px-3 py-3"
            >
              <div className="flex flex-1 flex-col gap-2">
                <div className="h-3.5 w-28 rounded bg-[var(--surface-3)]" />
                <div className="h-3 w-48 max-w-full rounded bg-[var(--surface-3)]/70" />
              </div>
              <div className="h-5 w-10 rounded bg-[var(--surface-3)]" />
            </div>
          ))}
        </div>
      ) : (
        <ul className="vk-scroll flex min-h-0 min-w-0 flex-1 flex-col gap-0.5 overflow-x-hidden overflow-y-auto p-2">
          {filtered.map((incident) => (
            <FeedRow
              key={incident.scanId}
              incident={incident}
              mounted={mounted}
              onSelect={handleRowClick}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
