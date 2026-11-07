import { formatScore } from '@/lib/format';
import { id } from '@/lib/i18n/id';
import {
  RISK_WEIGHTS,
  THRESHOLD_CRITICAL,
  THRESHOLD_SUSPICIOUS,
  VERDICT_VAR,
  bandOf,
} from '@/lib/verdict';
import type { ScoreBreakdown as Breakdown } from '@/lib/normalize';
import { VerdictIcon } from './icons';

/**
 * The three weighted components, plus the explainability delta.
 *
 * The engine computes 0.45*visual + 0.30*dom + 0.25*domain and THEN applies
 * deterministic override floors and caps (app/scoring.py). Showing the
 * pre-override base alongside the rule delta makes deterministic fusion
 * immediately legible to a review jury.
 */

function ComponentRow({
  label,
  value,
  weight,
}: {
  label: string;
  value: number | null;
  weight: number;
}) {
  if (value === null) {
    return (
      <div className="flex flex-col gap-1 py-1">
        <div className="flex items-baseline justify-between gap-2 text-[0.8125rem]">
          <span className="font-medium text-[var(--muted-strong)]">{label}</span>
          <span className="italic text-[var(--muted)]">{id.score.notApplicable}</span>
        </div>
      </div>
    );
  }

  const band = bandOf(value);
  const colorVar = `var(${VERDICT_VAR[band]})`;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-[0.8125rem]">
        <span className="font-medium text-[var(--muted-strong)]">
          {label}
          <span className="vk-mono ml-1.5 text-[0.75rem] text-[var(--muted)]">x{weight}</span>
        </span>
        <span className="vk-mono vk-tabular font-semibold text-[var(--foreground)]">
          {formatScore(value)}
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-[1px] bg-[var(--surface-3)]"
        aria-hidden="true"
      >
        <div
          className="h-full"
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
  const hasDelta = Math.abs(scores.ruleDelta) >= 0.05;
  const finalBand = bandOf(scores.total);
  const finalColor = `var(${VERDICT_VAR[finalBand]})`;

  return (
    <div className="min-w-0 p-4">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] pb-3">
        <div>
          <h2 className="vk-pane-label text-[var(--foreground)]">{id.score.total}</h2>
          <div className="vk-mono mt-1 text-[0.72rem] text-[var(--muted)]">
            {id.score.thresholdHintPrefix} &gt;={THRESHOLD_CRITICAL} {id.score.thresholdCritical} ·
            &gt;={THRESHOLD_SUSPICIOUS} {id.score.thresholdSuspicious}
          </div>
        </div>
        <div className="text-right">
          <div
            className="vk-mono vk-tabular inline-flex items-center gap-1.5 text-[2.25rem] leading-none font-bold tracking-[-0.03em]"
            style={{ color: finalColor }}
          >
            <VerdictIcon verdict={finalBand} size={20} />
            <span>{formatScore(scores.total)}</span>
          </div>
          <div className="vk-mono mt-0.5 text-[0.72rem] text-[var(--muted)]">/ 100</div>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-3">
        <ComponentRow label={id.score.visual} value={scores.visual} weight={RISK_WEIGHTS.visual} />
        <ComponentRow label={id.score.dom} value={scores.dom} weight={RISK_WEIGHTS.dom} />
        <ComponentRow label={id.score.domain} value={scores.domain} weight={RISK_WEIGHTS.domain} />
      </div>

      <dl className="mt-3 border-t border-[var(--border-subtle)] pt-2.5 text-[0.8125rem]">
        <div className="flex justify-between py-0.5">
          <dt className="text-[var(--muted)]">
            {id.score.weightedBase}
            {!scores.baseFromEngine && (
              <span className="ml-1 text-[0.75rem]">{id.score.recomputedNote}</span>
            )}
          </dt>
          <dd className="vk-mono vk-tabular text-[var(--muted-strong)]">
            {formatScore(scores.weightedBase)}
          </dd>
        </div>

        {hasDelta && (
          <div className="flex justify-between py-0.5">
            <dt className="text-[var(--muted)]">{id.score.ruleDelta}</dt>
            <dd
              className="vk-mono vk-tabular font-semibold"
              style={{
                color:
                  scores.ruleDelta > 0 ? 'var(--verdict-critical)' : 'var(--verdict-safe)',
              }}
            >
              {scores.ruleDelta > 0 ? '+' : ''}
              {formatScore(scores.ruleDelta)}
            </dd>
          </div>
        )}
      </dl>

      <div className="mt-3 border-t border-[var(--border-subtle)] pt-2.5">
        <h3 className="vk-pane-label mb-2">{id.score.appliedRules}</h3>
        {appliedRules.length === 0 ? (
          <div className="text-[0.75rem] text-[var(--muted)]">{id.score.noRules}</div>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)] rounded-[3px] border border-[var(--border)] bg-[var(--surface-1)]">
            {appliedRules.map((rule, idx) => (
              <li
                key={rule}
                className="flex items-start gap-2 px-2.5 py-1.5 text-[0.75rem] leading-snug text-[var(--muted-strong)]"
              >
                <span className="vk-mono vk-tabular shrink-0 text-[var(--verdict-suspicious)]">
                  0{idx + 1}
                </span>
                <span className="min-w-0 flex-1">{rule}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
