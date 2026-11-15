import { id } from '@/lib/i18n/id';

/**
 * Logo resmi Jagabaya (perisai hijau TNI AD dengan mata pengawas emas, latar transparan).
 */
export function BrandMark({
  size = 30,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static local brand asset
    <img
      src="/brand/jagabaya-logo.png"
      width={size}
      height={size}
      alt={id.app.name}
      className={['shrink-0 select-none object-contain', className ?? ''].filter(Boolean).join(' ')}
    />
  );
}
