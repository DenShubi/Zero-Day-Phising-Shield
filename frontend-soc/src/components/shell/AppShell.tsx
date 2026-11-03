'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { id } from '@/lib/i18n/id';
import { HealthStrip } from './HealthStrip';

const NAV = [
  { href: '/', label: id.nav.command },
  { href: '/sandbox', label: id.nav.sandbox },
  { href: '/audit', label: id.nav.audit },
  { href: '/mitigasi', label: id.nav.mitigation },
  { href: '/whatsapp', label: id.nav.whatsapp },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="vk-no-print sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--surface)]/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3">
          <Link href="/" className="flex items-center gap-3 no-underline">
            <span
              aria-hidden="true"
              className="grid h-9 w-9 place-items-center rounded border border-[var(--accent)] bg-[var(--accent)]/15 text-sm font-bold text-[var(--accent-bright)]"
            >
              VK
            </span>
            <span className="leading-tight">
              <span className="block text-[0.95rem] font-semibold text-[var(--foreground)]">
                {id.app.name}
              </span>
              <span className="block text-xs text-[var(--muted)]">{id.app.org}</span>
            </span>
          </Link>

          <nav className="flex flex-wrap gap-1" aria-label="Navigasi utama">
            {NAV.map((item) => {
              // Only "/" needs an exact match; the rest match their subtree.
              const active =
                item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={[
                    'rounded px-3 py-1.5 text-sm no-underline transition-colors',
                    active
                      ? 'bg-[var(--accent)]/20 text-[var(--accent-bright)]'
                      : 'text-[var(--muted-strong)] hover:bg-[var(--surface-raised)]',
                  ].join(' ')}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto">
            <HealthStrip />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1600px] flex-1 px-5 py-6">{children}</main>

      <footer className="vk-no-print border-t border-[var(--border)] px-5 py-4 text-xs text-[var(--muted)]">
        {id.app.name} — {id.app.subtitle}. Seluruh target uji adalah simulasi internal yang
        di-host sendiri; sistem tidak menyerang infrastruktur pihak ketiga.
      </footer>
    </div>
  );
}
