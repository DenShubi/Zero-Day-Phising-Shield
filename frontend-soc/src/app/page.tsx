'use client';

import { useMemo } from 'react';
import { useIncidentFeed } from '@/lib/supabase/useIncidentFeed';
import { IncidentFeed } from '@/components/feed/IncidentFeed';
import { VerdictBadge } from '@/components/ui/VerdictBadge';
import { formatScore } from '@/lib/format';
import { id } from '@/lib/i18n/id';
import { VERDICT_ORDER, VERDICT_VAR, type Verdict } from '@/lib/verdict';
import { locateUnit } from '@/lib/units-geo';

function Tile({
  label,
  value,
  hint,
  color,
}: {
  label: string;
  value: string;
  hint?: string;
  color?: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p
        className="vk-mono mt-1 text-2xl font-bold tabular-nums"
        style={{ color: color ?? 'var(--foreground)' }}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-[var(--muted)]">{hint}</p>}
    </div>
  );
}

export default function CommandCentrePage() {
  const feed = useIncidentFeed();
  const { incidents } = feed;

  const stats = useMemo(() => {
    const counts: Record<Verdict, number> = {
      SAFE: 0,
      SUSPICIOUS: 0,
      CRITICAL_PHISHING: 0,
    };
    let scoreSum = 0;
    let mapped = 0;

    for (const i of incidents) {
      counts[i.verdict] += 1;
      scoreSum += i.scores.total;
      if (locateUnit(i.reporterUnit)) mapped += 1;
    }

    return {
      counts,
      total: incidents.length,
      meanScore: incidents.length > 0 ? scoreSum / incidents.length : 0,
      mapped,
      unmapped: incidents.length - mapped,
    };
  }, [incidents]);

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-xl font-semibold text-[var(--foreground)]">{id.nav.command}</h1>
        <p className="mt-0.5 text-sm text-[var(--muted)]">
          Pemantauan insiden phishing secara langsung dari seluruh kanal pelaporan.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Tile label="Total Insiden" value={String(stats.total)} />
        {VERDICT_ORDER.map((v) => (
          <Tile
            key={v}
            label={
              v === 'CRITICAL_PHISHING'
                ? 'Kritis'
                : v === 'SUSPICIOUS'
                  ? 'Mencurigakan'
                  : 'Aman'
            }
            value={String(stats.counts[v])}
            color={`var(${VERDICT_VAR[v]})`}
          />
        ))}
        <Tile label="Rerata Skor" value={formatScore(stats.meanScore)} hint="dari 100" />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_minmax(26rem,38%)]">
        <div className="flex flex-col gap-5">
          {/* The map lands in build step 6; this placeholder keeps the layout
              honest meanwhile and already surfaces the unmapped count, which is
              the majority case with WhatsApp-originated reports. */}
          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
            <h2 className="text-sm font-semibold text-[var(--foreground)]">
              Sebaran Asal Laporan
            </h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Peta menampilkan asal laporan, bukan lokasi pelaku.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2">
                <p className="text-xs text-[var(--muted)]">Terpeta</p>
                <p className="vk-mono text-lg font-semibold tabular-nums">{stats.mapped}</p>
              </div>
              <div className="rounded border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2">
                <p className="text-xs text-[var(--muted)]">{id.common.unmapped}</p>
                <p className="vk-mono text-lg font-semibold tabular-nums">{stats.unmapped}</p>
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
            <h2 className="mb-3 text-sm font-semibold text-[var(--foreground)]">
              Distribusi Putusan
            </h2>
            {stats.total === 0 ? (
              <p className="text-sm text-[var(--muted)]">{id.feed.empty}</p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {VERDICT_ORDER.map((v) => {
                  const pct = (stats.counts[v] / stats.total) * 100;
                  return (
                    <div key={v} className="grid grid-cols-[10rem_1fr_3rem] items-center gap-3">
                      <VerdictBadge verdict={v} size="sm" />
                      <span className="h-2.5 overflow-hidden rounded-full bg-[var(--surface-raised)]">
                        <span
                          className="block h-full rounded-full"
                          style={{ width: `${pct}%`, background: `var(${VERDICT_VAR[v]})` }}
                        />
                      </span>
                      <span className="vk-mono text-right text-sm tabular-nums">
                        {stats.counts[v]}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <IncidentFeed
          incidents={feed.incidents}
          status={feed.status}
          lastEventAt={feed.lastEventAt}
          error={feed.error}
          onRefresh={feed.refresh}
        />
      </div>
    </div>
  );
}
