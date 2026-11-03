import Link from 'next/link';
import { id } from '@/lib/i18n/id';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
      <h2 className="text-lg font-semibold text-[var(--foreground)]">Halaman tidak ditemukan</h2>
      <p className="mt-2 text-sm text-[var(--muted-strong)]">
        Alamat yang diminta tidak tersedia pada dasbor ini.
      </p>
      <Link
        href="/"
        className="mt-4 inline-block rounded bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white no-underline"
      >
        {id.nav.command}
      </Link>
    </div>
  );
}
