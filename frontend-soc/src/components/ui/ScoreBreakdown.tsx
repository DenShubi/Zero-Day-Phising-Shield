import { formatScore } from '@/lib/format';
import { id } from '@/lib/i18n/id';
import { VERDICT_VAR, bandOf } from '@/lib/verdict';
import type { ScoreBreakdown as Breakdown } from '@/lib/normalize';
import { VerdictIcon } from './icons';

function ComponentRow({
  label,
  value,
}: {
  label: string;
  value: number | null;
}) {
  if (value === null) {
    return (
      <div className="flex items-baseline justify-between gap-2 text-[0.8125rem]">
        <span className="text-[var(--muted-strong)]">{label}</span>
        <span className="text-[0.75rem] text-[var(--muted)]">{id.score.notApplicable}</span>
      </div>
    );
  }

  const band = bandOf(value);
  const colorVar = `var(${VERDICT_VAR[band]})`;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-[0.8125rem]">
        <span className="text-[var(--muted-strong)]">{label}</span>
        <span className="vk-tabular font-semibold text-[var(--foreground)]">
          {formatScore(value)}
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-[var(--r-pill)] bg-[var(--surface-3)]"
        aria-hidden="true"
      >
        <div
          className="h-full rounded-[var(--r-pill)]"
          style={{ width: `${Math.max(2, value)}%`, background: colorVar }}
        />
      </div>
    </div>
  );
}

export function ScoreBreakdownPanel({
  scores,
  appliedRules,
}: {
  scores: Breakdown;
  appliedRules: readonly string[];
}) {
  const finalBand = bandOf(scores.total);
  const finalColor = `var(${VERDICT_VAR[finalBand]})`;

  return (
    <div className="min-w-0 p-4">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-3">
        <span className="vk-section-title">
          {id.score.total}
        </span>
        <div
          className="vk-metric inline-flex items-baseline gap-1.5"
          style={{ color: finalColor }}
        >
          <VerdictIcon verdict={finalBand} size={18} />
          <span>{formatScore(scores.total)}</span>
          <span className="text-[0.8125rem] font-normal text-[var(--muted)]">/ 100</span>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-2.5">
        <ComponentRow label={id.score.visual} value={scores.visual} />
        <ComponentRow label={id.score.dom} value={scores.dom} />
        <ComponentRow label={id.score.domain} value={scores.domain} />
      </div>

      {appliedRules.length > 0 && (
        <div className="mt-3 border-t border-[var(--border-subtle)] pt-2.5">
          <div className="mb-1.5 text-[0.75rem] font-medium text-[var(--muted-strong)]">
            {id.score.appliedRules}
          </div>
          <ul className="flex flex-col gap-1">
            {appliedRules.map((rule) => (
              <li
                key={rule}
                className="rounded-[var(--r-md)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[0.75rem] leading-snug text-[var(--muted-strong)]"
              >
                {rule}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
