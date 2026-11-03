'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { NormalizedScan } from '@/lib/normalize';
import { describeTarget, formatAge, formatScore, truncateMiddle } from '@/lib/format';
import { id } from '@/lib/i18n/id';
import type { FeedStatus } from '@/lib/supabase/useIncidentFeed';
import { VerdictBadge } from '@/components/ui/VerdictBadge';

/**
 * The connection pill is not decoration: without it a dead socket looks exactly
 * like "no new incidents", which is the failure mode most likely to mislead an
 * operator mid-demo.
 */
function StatusPill({ status, lastEventAt }: { status: FeedStatus; lastEventAt: number | null }) {
  const map: Record<FeedStatus, { label: string; color: string; pulse: boolean }> = {
    connecting: { label: id.feed.connecting, color: 'var(--muted)', pulse: true },
    live: { label: id.feed.live, color: 'var(--verdict-safe)', pulse: true },
    reconnecting: { label: id.feed.reconnecting, color: 'var(--verdict-suspicious)', pulse: true },
    offline: { label: id.feed.offline, color: 'var(--verdict-critical)', pulse: false },
    unconfigured: { label: 'Riwayat saja', color: 'var(--muted)', pulse: false },
  };
  const s = map[status];
  return (
    <span className="flex items-center gap-1.5 text-xs text-[var(--muted-strong)]">
      <span
        aria-hidden="true"
        className={`inline-block h-2 w-2 rounded-full ${s.pulse ? 'animate-pulse' : ''}`}
        style={{ background: s.color }}
      />
      {s.label}
      {lastEventAt !== null && status === 'live' && (
        <span className="text-[var(--muted)]">· terakhir {formatAge(lastEventAt)}</span>
      )}
    </span>
  );
}

function Row({ incident }: { incident: NormalizedScan }) {
  // Age is recomputed on a ticking clock supplied by the parent, so rows do not
  // each hold their own timer.
  const target = incident.finalUrl ?? describeTarget(incident.submittedUrl);

  return (
    <li>
      <Link
        href={`/forensics?id=${encodeURIComponent(incident.incidentId ?? incident.scanId)}`}
        className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded border border-transparent px-3 py-2.5 no-underline transition-colors hover:border-[var(--border)] hover:bg-[var(--surface-raised)]"
      >
        <VerdictBadge verdict={incident.verdict} size="sm" />

        <span className="min-w-0">
          <span className="vk-mono block truncate text-sm text-[var(--foreground)]">
            {truncateMiddle(target, 64)}
          </span>
          <span className="block truncate text-xs text-[var(--muted)]">
            {incident.reporterUnit ?? '—'}
            {incident.reporterSource && ` · ${incident.reporterSource}`}
            {incident.ticket && ` · ${incident.ticket}`}
          </span>
        </span>

        <span className="text-right">
          <span className="vk-mono block text-sm font-semibold tabular-nums text-[var(--foreground)]">
            {formatScore(incident.scores.total)}
          </span>
          <span className="block text-xs text-[var(--muted)]">
            {formatAge(incident.createdAtMs)}
          </span>
        </span>
      </Link>
    </li>
  );
}

export function IncidentFeed({
  incidents,
  status,
  lastEventAt,
  error,
  onRefresh,
  limit = 25,
}: {
  incidents: readonly NormalizedScan[];
  status: FeedStatus;
  lastEventAt: number | null;
  error: string | null;
  onRefresh: () => void;
  limit?: number;
}) {
  // One shared clock drives every row's relative age.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  const shown = incidents.slice(0, limit);

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <header className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] px-4 py-3">
        <h2 className="text-sm font-semibold text-[var(--foreground)]">{id.feed.title}</h2>
        <StatusPill status={status} lastEventAt={lastEventAt} />
        <button
          type="button"
          onClick={onRefresh}
          className="ml-auto rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted-strong)] hover:bg-[var(--surface-raised)]"
        >
          {id.feed.refresh}
        </button>
      </header>

      {status === 'unconfigured' && (
        <p className="border-b border-[var(--border)] px-4 py-2 text-xs text-[var(--muted)]">
          {id.feed.unconfigured}
        </p>
      )}

      {error && (
        <p className="border-b border-[var(--border)] px-4 py-2 text-xs text-[var(--verdict-critical)]">
          {error}
        </p>
      )}

      {shown.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-[var(--muted)]">{id.feed.empty}</p>
      ) : (
        <ul className="flex flex-col p-1.5">
          {shown.map((incident) => (
            <Row key={incident.scanId} incident={incident} />
          ))}
        </ul>
      )}
    </section>
  );
}
