'use client';

/**
 * Hero Confusion Matrix: large tabular figures, meaningful diagonal coloring,
 * and explicit operational asymmetry (FN = leaked threat vs FP = analyst queue).
 */

import type { BenchmarkMetrics } from '@/lib/api/endpoints';
import { id as t } from '@/lib/i18n/id';
import {
  IconAlertTriangle,
  IconOctagonAlert,
  IconShieldCheck,
} from '@/components/ui/icons';

function MatrixCell({
  label,
  value,
  variant,
  hint,
}: {
  label: string;
  value: number;
  variant: 'diagonal' | 'fn' | 'fp';
  hint: string;
}) {
  const color =
    variant === 'diagonal'
      ? 'var(--verdict-safe)'
      : variant === 'fn'
        ? 'var(--verdict-critical)'
        : 'var(--verdict-suspicious)';

  return (
    <div
      data-ui="matrix-cell"
      className="flex flex-col justify-between rounded-lg border p-3.5"
      style={{
        borderColor: `color-mix(in srgb, ${color} 38%, transparent)`,
        background: `color-mix(in srgb, ${color} 9%, var(--surface-2))`,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[0.8125rem] font-medium tracking-[0.01em] text-[var(--muted-strong)]">
          {label}
        </span>
        <span style={{ color }}>
          {variant === 'diagonal' ? (
            <IconShieldCheck size={16} />
          ) : variant === 'fn' ? (
            <IconOctagonAlert size={16} />
          ) : (
            <IconAlertTriangle size={16} />
          )}
        </span>
      </div>

      <div
        className="vk-mono vk-tabular my-2 text-[3rem] leading-[1.05] font-bold tracking-[-0.03em]"
        style={{ color }}
      >
        {value}
      </div>

      <div className="text-[0.8125rem] leading-snug text-[var(--muted-strong)]">{hint}</div>
    </div>
  );
}

export function ConfusionMatrix({ metrics }: { metrics: BenchmarkMetrics }) {
  return (
    <div className="vk-bento flex h-full min-w-0 flex-col justify-between p-4">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[1.125rem] font-semibold tracking-[-0.01em] text-[var(--foreground)]">
            {t.audit.matrixTitle}
          </h3>
          <span className="vk-mono vk-tabular text-[0.8125rem] text-[var(--muted)]">
            {metrics.total} {t.audit.samplesSuffix}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <MatrixCell
            label={t.audit.tpLabel}
            value={metrics.tp}
            variant="diagonal"
            hint={t.audit.tpHint}
          />
          <MatrixCell
            label={t.audit.fnLabel}
            value={metrics.fn}
            variant="fn"
            hint={t.audit.fnHint}
          />
          <MatrixCell
            label={t.audit.fpLabel}
            value={metrics.fp}
            variant="fp"
            hint={t.audit.fpHint}
          />
          <MatrixCell
            label={t.audit.tnLabel}
            value={metrics.tn}
            variant="diagonal"
            hint={t.audit.tnHint}
          />
        </div>
      </div>

      <div className="mt-3.5 border-t border-[var(--border-subtle)] pt-3">
        <dl className="grid grid-cols-2 gap-4 text-[0.8125rem]">
          <div className="flex items-center justify-between rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5">
            <dt className="text-[var(--muted)]">{t.audit.fnrLabel}</dt>
            <dd
              className="vk-mono vk-tabular font-semibold"
              style={{
                color: metrics.fnr === 0 ? 'var(--verdict-safe)' : 'var(--verdict-critical)',
              }}
            >
              {metrics.fnr.toFixed(2)}%
            </dd>
          </div>
          <div className="flex items-center justify-between rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5">
            <dt className="text-[var(--muted)]">{t.audit.fprLabel}</dt>
            <dd className="vk-mono vk-tabular font-semibold text-[var(--foreground)]">
              {metrics.fpr.toFixed(2)}%
            </dd>
          </div>
        </dl>

        <div className="mt-2.5 text-[0.8125rem] leading-relaxed text-[var(--muted)]">
          {t.audit.asymmetryNote}
        </div>
      </div>
    </div>
  );
}
