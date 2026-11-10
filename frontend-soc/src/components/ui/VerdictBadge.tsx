import { VERDICT_LABEL, VERDICT_VAR, type Verdict } from '@/lib/verdict';
import { VerdictIcon } from './icons';

/**
 * Verdict pill. Never encodes state by colour alone: the icon and the
 * Indonesian label carry it too, so it still reads in greyscale or print.
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
      ? 'h-7 px-2.5 text-[0.78rem]'
      : size === 'sm'
        ? 'h-5 px-2 text-[0.6875rem]'
        : 'h-6 px-2.5 text-[0.72rem]';

  const iconSize = size === 'lg' ? 14 : size === 'sm' ? 11 : 12;
  const colorVar = `var(${VERDICT_VAR[verdict]})`;

  return (
    <span
      className={`vk-pill ${sizing}`}
      style={{
        color: colorVar,
        background: `color-mix(in srgb, ${colorVar} 12%, transparent)`,
      }}
    >
      <VerdictIcon verdict={verdict} size={iconSize} />
      <span>{VERDICT_LABEL[verdict]}</span>
    </span>
  );
}
