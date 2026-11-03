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

/**
 * The three weighted components, plus the explainability delta.
 *
 * The engine computes 0.45*visual + 0.30*dom + 0.25*domain and THEN applies
 * deterministic override floors and caps (app/scoring.py). So the three bars
 * genuinely do not add up to the final score whenever a rule fired — showing
 * the components alone would look like an arithmetic bug. The delta row makes
 * that gap the point instead: it is the clearest explainability story the
 * engine has, and `weighted_score` is persisted so it works on stored rows too.
 */

function Component({
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
      <div className="grid grid-cols-[9rem_1fr_4.5rem] items-center gap-3 text-sm">
        <span className="text-[var(--muted-strong)]">{label}</span>
        <span className="text-xs italic text-[var(--muted)]">{id.score.notApplicable}</span>
        <span className="text-right text-[var(--muted)]">—</span>
      </div>
    );
  }
  const band = bandOf(value);
  return (
    <div className="grid grid-cols-[9rem_1fr_4.5rem] items-center gap-3 text-sm">
      <span className="text-[var(--muted-strong)]">
        {label}
        <span className="ml-1 text-[0.7rem] text-[var(--muted)]">×{weight}</span>
      </span>
      <span
        className="h-2.5 overflow-hidden rounded-full bg-[var(--surface-raised)]"
        role="img"
        aria-label={`${label}: ${formatScore(value)} dari 100`}
      >
        <span
          className="block h-full rounded-full transition-[width]"
          style={{ width: `${value}%`, background: `var(${VERDICT_VAR[band]})` }}
        />
      </span>
      <span className="vk-mono text-right tabular-nums text-[var(--foreground)]">
        {formatScore(value)}
      </span>
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
  // Rounding noise shouldn't be presented as a rule adjustment.
  const hasDelta = Math.abs(scores.ruleDelta) >= 0.05;

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <h3 className="mb-3 text-sm font-semibold text-[var(--foreground)]">{id.score.total}</h3>

      <div className="flex flex-col gap-2.5">
        <Component label={id.score.visual} value={scores.visual} weight={RISK_WEIGHTS.visual} />
        <Component label={id.score.dom} value={scores.dom} weight={RISK_WEIGHTS.dom} />
        <Component label={id.score.domain} value={scores.domain} weight={RISK_WEIGHTS.domain} />
      </div>

      <dl className="mt-4 border-t border-[var(--border)] pt-3 text-sm">
        <div className="flex justify-between py-0.5">
          <dt className="text-[var(--muted-strong)]">
            {id.score.weightedBase}
            {!scores.baseFromEngine && (
              <span className="ml-1 text-[0.7rem] text-[var(--muted)]">(dihitung ulang)</span>
            )}
          </dt>
          <dd className="vk-mono tabular-nums text-[var(--muted-strong)]">
            {formatScore(scores.weightedBase)}
          </dd>
        </div>

        {hasDelta && (
          <div className="flex justify-between py-0.5">
            <dt className="text-[var(--muted-strong)]">{id.score.ruleDelta}</dt>
            <dd
              className="vk-mono tabular-nums"
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

        <div className="mt-1 flex justify-between border-t border-[var(--border)] pt-2">
          <dt className="font-semibold text-[var(--foreground)]">{id.score.final}</dt>
          <dd
            className="vk-mono text-lg font-bold tabular-nums"
            style={{ color: `var(${VERDICT_VAR[bandOf(scores.total)]})` }}
          >
            {formatScore(scores.total)}
            <span className="ml-1 text-xs font-normal text-[var(--muted)]">/ 100</span>
          </dd>
        </div>
      </dl>

      {/* Band reference, so a reader can place the score without prior context. */}
      <p className="mt-2 text-[0.7rem] text-[var(--muted)]">
        Ambang: ≥ {THRESHOLD_CRITICAL} kritis · ≥ {THRESHOLD_SUSPICIOUS} mencurigakan
      </p>

      <div className="mt-4 border-t border-[var(--border)] pt-3">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          {id.score.appliedRules}
        </h4>
        {appliedRules.length === 0 ? (
          <p className="text-xs text-[var(--muted)]">{id.score.noRules}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {appliedRules.map((rule) => (
              <li
                key={rule}
                className="rounded border-l-2 bg-[var(--surface-raised)] px-2.5 py-1.5 text-xs leading-snug text-[var(--muted-strong)]"
                style={{ borderLeftColor: 'var(--verdict-suspicious)' }}
              >
                {rule}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
