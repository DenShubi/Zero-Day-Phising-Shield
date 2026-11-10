import { id } from '@/lib/i18n/id';

/**
 * LOGO PLACEHOLDER - replace this file's contents with the real mark.
 *
 * Deliberately neutral: a dashed tile with a generic image glyph, so nobody
 * mistakes it for the finished brand. To swap it in, drop the artwork here and
 * keep the same box (`size` square, `--r-md` corners); nothing else in the app
 * needs to change.
 *
 *   export function BrandMark({ size = 30 }: { size?: number }) {
 *     return <img src="/brand/logo.svg" width={size} height={size} alt="" />;
 *   }
 */
export function BrandMark({
  size = 30,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={id.nav.logoPlaceholder}
      title={id.nav.logoPlaceholder}
      data-placeholder="logo"
      style={{ width: size, height: size }}
      className={[
        'grid shrink-0 place-items-center rounded-[var(--r-md)]',
        'border border-dashed border-[var(--border-strong)] bg-[var(--surface-3)]',
        'text-[var(--muted)]',
        className ?? '',
      ].join(' ')}
    >
      <svg
        width={Math.round(size * 0.5)}
        height={Math.round(size * 0.5)}
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <rect
          x="1.75"
          y="2.75"
          width="12.5"
          height="10.5"
          rx="2"
          stroke="currentColor"
          strokeWidth="1.3"
        />
        <circle cx="5.9" cy="6.6" r="1.15" fill="currentColor" />
        <path
          d="M2.6 12.1L6.3 8.9L9 11.2L11.3 9.3L13.4 11.2"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
