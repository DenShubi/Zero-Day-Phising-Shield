'use client';

/**
 * Stage-by-stage latency waterfall against the 5-second field SLA.
 */

import { id as t } from '@/lib/i18n/id';
import { IconAlertTriangle, IconShieldCheck } from '@/components/ui/icons';

const SLA_MS = 5000;

const STAGE_LABELS: Readonly<Record<string, string>> = t.latencyStages;
const TOTAL_KEYS = new Set(['total_ms', 'phase1_total_ms']);

export function LatencyWaterfall({ latencyMs }: { latencyMs: Record<string, number> }) {
  const entries = Object.entries(latencyMs);
  if (entries.length === 0) return null;

  const total =
    latencyMs.total_ms ??
    entries.reduce((sum, [k, v]) => (TOTAL_KEYS.has(k) ? sum : sum + v), 0);
  const stages = entries
    .filter(([k, v]) => !TOTAL_KEYS.has(k) && v > 0)
    .sort((a, b) => b[1] - a[1]);

  const scale = Math.max(total, SLA_MS);
  const overSla = total > SLA_MS;
  const statusColor = overSla ? 'var(--verdict-suspicious)' : 'var(--verdict-safe)';

  return (
    <div className="vk-bento min-w-0 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[1.125rem] font-semibold tracking-[-0.01em] text-[var(--foreground)]">
          {t.forensics.latency}
        </h3>
        <span
          className="vk-mono vk-tabular inline-flex items-center gap-1.5 text-[0.875rem] font-semibold"
          style={{ color: statusColor }}
        >
          {overSla ? <IconAlertTriangle size={14} /> : <IconShieldCheck size={14} />}
          <span>
            {(total / 1000).toFixed(2)} {t.scan.elapsedUnit}
          </span>
        </span>
      </div>

      <div className="mt-1 text-[0.8125rem] text-[var(--muted)]">
        {t.forensics.slaTargetPrefix} {SLA_MS / 1000} {t.scan.elapsedUnit} —{' '}
        <span style={{ color: statusColor }}>
          {overSla ? t.forensics.slaExceeded : t.forensics.slaMet}
        </span>
      </div>

      <ul className="mt-3 flex flex-col gap-2">
        {stages.map(([key, ms]) => {
          const pct = Math.min(100, (ms / scale) * 100);
          const isNetwork = key === 'supabase_sync_ms';
          return (
            <li
              key={key}
              className="grid grid-cols-[1fr_4.5rem] gap-x-2 gap-y-1 text-[0.8125rem]"
            >
              <span className="truncate text-[var(--muted-strong)]">
                {STAGE_LABELS[key] ?? key}
              </span>
              <span className="vk-mono vk-tabular text-right text-[var(--foreground)]">
                {ms >= 1000
                  ? `${(ms / 1000).toFixed(2)} ${t.audit.secShort}`
                  : `${Math.round(ms)} ${t.audit.msShort}`}
              </span>
              <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-3)]">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${pct}%`,
                    background: isNetwork ? 'var(--muted)' : 'var(--accent-ink)',
                  }}
                />
              </span>
            </li>
          );
        })}
      </ul>

      {latencyMs.supabase_sync_ms > 0 && (
        <div className="mt-3 border-t border-[var(--border-subtle)] pt-2.5 text-[0.8125rem] leading-relaxed text-[var(--muted)]">
          {t.forensics.networkSyncNote}
        </div>
      )}
    </div>
  );
}
