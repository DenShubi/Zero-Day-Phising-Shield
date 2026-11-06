import { VERDICT_LABEL, VERDICT_VAR, type Verdict } from '@/lib/verdict';
import { VerdictIcon } from './icons';

/**
 * Verdict is never encoded by colour alone: each badge carries an inline SVG
 * icon and the Indonesian text label, consuming the single-source CSS variables
 * in globals.css so projector legibility, greyscale print, and colour-blind
 * accessibility all hold simultaneously.
 */

export function VerdictBadge({
  verdict,
  size = 'md',
}: {
  verdict: Verdict;
  size?: 'sm' | 'md' | 'lg';
}) {
  const sizing =
    size === 'lg'
      ? 'px-3 py-1.5 text-[0.8125rem] gap-1.5'
      : size === 'sm'
        ? 'px-2 py-0.5 text-[0.75rem] gap-1'
        : 'px-2.5 py-1 text-[0.8125rem] gap-1.5';

  const iconSize = size === 'lg' ? 16 : size === 'sm' ? 13 : 14;
  const colorVar = `var(${VERDICT_VAR[verdict]})`;

  return (
    <span
      className={`inline-flex items-center rounded-full border font-semibold tracking-[0.02em] whitespace-nowrap ${sizing}`}
      style={{
        color: colorVar,
        borderColor: `color-mix(in srgb, ${colorVar} 42%, transparent)`,
        background: `color-mix(in srgb, ${colorVar} 12%, transparent)`,
      }}
    >
      <VerdictIcon verdict={verdict} size={iconSize} />
      <span>{VERDICT_LABEL[verdict]}</span>
    </span>
  );
}
