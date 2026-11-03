import { VERDICT_LABEL, VERDICT_VAR, type Verdict } from '@/lib/verdict';

/**
 * Verdict is never encoded by colour alone: each badge carries a glyph and the
 * written label too, so it survives a projector, a greyscale print, and a
 * colour-blind reader.
 */

const GLYPH: Record<Verdict, string> = {
  SAFE: '✓',
  SUSPICIOUS: '!',
  CRITICAL_PHISHING: '✕',
};

export function VerdictBadge({
  verdict,
  size = 'md',
}: {
  verdict: Verdict;
  size?: 'sm' | 'md' | 'lg';
}) {
  const pad =
    size === 'lg' ? 'px-3 py-1.5 text-sm' : size === 'sm' ? 'px-1.5 py-0.5 text-[0.7rem]' : 'px-2 py-1 text-xs';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border font-semibold uppercase tracking-wide ${pad}`}
      style={{
        color: `var(${VERDICT_VAR[verdict]})`,
        borderColor: `color-mix(in srgb, var(${VERDICT_VAR[verdict]}) 45%, transparent)`,
        background: `color-mix(in srgb, var(${VERDICT_VAR[verdict]}) 14%, transparent)`,
      }}
    >
      <span aria-hidden="true">{GLYPH[verdict]}</span>
      {VERDICT_LABEL[verdict]}
    </span>
  );
}
