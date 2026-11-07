import { VERDICT_LABEL, VERDICT_VAR, type Verdict } from '@/lib/verdict';
import { VerdictIcon } from './icons';

/**
 * Technical rectangular verdict tag (3px corner radius, Geist Mono uppercase).
 * Never encodes state by colour alone: pairs inline geometric icon + Indonesian
 * label, consuming single-source CSS custom properties from globals.css.
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
      ? 'px-2.5 py-1 text-[0.75rem] gap-1.5'
      : size === 'sm'
        ? 'px-1.5 py-0.5 text-[0.6875rem] gap-1'
        : 'px-2 py-0.5 text-[0.71875rem] gap-1.5';

  const iconSize = size === 'lg' ? 14 : size === 'sm' ? 11 : 12;
  const colorVar = `var(${VERDICT_VAR[verdict]})`;

  return (
    <span
      className={`vk-mono inline-flex items-center rounded-[3px] border font-semibold tracking-[0.04em] uppercase whitespace-nowrap ${sizing}`}
      style={{
        color: colorVar,
        borderColor: `color-mix(in srgb, ${colorVar} 45%, transparent)`,
        background: `color-mix(in srgb, ${colorVar} 9%, transparent)`,
      }}
    >
      <VerdictIcon verdict={verdict} size={iconSize} />
      <span>{VERDICT_LABEL[verdict]}</span>
    </span>
  );
}
