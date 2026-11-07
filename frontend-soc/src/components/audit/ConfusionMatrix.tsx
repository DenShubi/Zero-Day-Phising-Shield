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
      className="flex flex-col justify-between p-3.5"
      style={{
        background: `color-mix(in srgb, ${color} 7%, var(--surface-1))`,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="vk-mono text-[0.72rem] font-semibold uppercase tracking-[0.03em] text-[var(--muted-strong)]">
          {label}
        </span>
        <span style={{ color }} aria-hidden="true">
          {variant === 'diagonal' ? (
            <IconShieldCheck size={15} />
          ) : variant === 'fn' ? (
            <IconOctagonAlert size={15} />
          ) : (
            <IconAlertTriangle size={15} />
          )}
        </span>
      </div>

      <div
        className="vk-mono vk-tabular my-2 text-[2.625rem] leading-none font-bold tracking-[-0.035em]"
        style={{ color }}
      >
        {value}
      </div>

      <div className="text-[0.75rem] leading-snug text-[var(--muted-strong)]">{hint}</div>
    </div>
  );
}

export function ConfusionMatrix({ metrics }: { metrics: BenchmarkMetrics }) {
  return (
    <div className="flex h-full min-w-0 flex-col justify-between p-4 sm:p-5">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="vk-pane-label text-[var(--foreground)]">{t.audit.matrixTitle}</h2>
          <span className="vk-mono vk-tabular text-[0.75rem] text-[var(--muted)]">
            {metrics.total} {t.audit.samplesSuffix}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-2 divide-x divide-y divide-[var(--border)] overflow-hidden rounded-[3px] border border-[var(--border-strong)] bg-[var(--surface-1)]">
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

      <div className="mt-4 border-t border-[var(--border-subtle)] pt-3">
        <dl className="grid grid-cols-2 divide-x divide-[var(--border)] overflow-hidden rounded-[3px] border border-[var(--border)] bg-[var(--surface-1)] text-[0.75rem]">
          <div className="flex items-center justify-between gap-2 px-3 py-2">
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
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <dt className="text-[var(--muted)]">{t.audit.fprLabel}</dt>
            <dd className="vk-mono vk-tabular font-semibold text-[var(--foreground)]">
              {metrics.fpr.toFixed(2)}%
            </dd>
          </div>
        </dl>

        <p className="mt-2.5 text-[0.75rem] leading-relaxed text-[var(--muted)]">
          {t.audit.asymmetryNote}
        </p>
      </div>
    </div>
  );
}
