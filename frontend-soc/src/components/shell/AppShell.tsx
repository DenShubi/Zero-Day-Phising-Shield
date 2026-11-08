'use client';

/**
 * Bilah navigasi utama satu baris: ringkas, bersih, tanpa kode modul buatan.
 */

import { Suspense, useCallback, type ComponentType, type MouseEvent } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { id } from '@/lib/i18n/id';
import { buildPanelHref, parsePanelView, type PanelId } from '@/lib/panel-route';
import { HealthStrip } from './HealthStrip';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import {
  IconAudit,
  IconCommand,
  IconForensics,
  IconMitigation,
  IconScan,
  IconWhatsapp,
  VisiKartikaMark,
} from '@/components/ui/icons';

interface NavSpec {
  view: PanelId;
  label: string;
  Icon: ComponentType<{ size?: number; className?: string }>;
}

const NAV_ITEMS: readonly NavSpec[] = [
  { view: 'komando', label: id.nav.command, Icon: IconCommand },
  { view: 'pemindaian', label: id.nav.scan, Icon: IconScan },
  { view: 'forensik', label: id.nav.forensics, Icon: IconForensics },
  { view: 'mitigasi', label: id.nav.mitigation, Icon: IconMitigation },
  { view: 'lapor-cepat', label: id.nav.whatsapp, Icon: IconWhatsapp },
  { view: 'audit', label: id.nav.audit, Icon: IconAudit },
] as const;

function NavMatrixLinks() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeView = parsePanelView(searchParams.get('view'));

  const handleNavClick = useCallback(
    (e: MouseEvent<HTMLAnchorElement>, view: PanelId, href: string) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      if (pathname !== '/') return;
      e.preventDefault();
      if (view === activeView) return;
      router.replace(href, { scroll: false });
    },
    [pathname, activeView, router],
  );

  return (
    <nav
      aria-label={id.nav.primaryAria}
      className="vk-scroll flex items-center gap-1 overflow-x-auto"
    >
      {NAV_ITEMS.map(({ view, label, Icon }) => {
        const href = buildPanelHref(view);
        const active = pathname === '/' && activeView === view;
        return (
          <a
            key={view}
            href={href}
            aria-current={active ? 'page' : undefined}
            onClick={(e) => handleNavClick(e, view, href)}
            className={[
              'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[4px] px-2.5 text-[0.8125rem] no-underline transition-colors duration-100',
              active
                ? 'border border-[var(--accent-border)] bg-[var(--accent-tint)] font-semibold text-[var(--foreground)]'
                : 'border border-transparent text-[var(--muted-strong)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]',
            ].join(' ')}
          >
            <Icon
              size={14}
              className={
                active
                  ? 'shrink-0 text-[var(--accent-ink)]'
                  : 'shrink-0 text-[var(--muted)]'
              }
            />
            <span>{label}</span>
          </a>
        );
      })}
    </nav>
  );
}

function NavMatrixFallback() {
  return (
    <nav
      aria-label={id.nav.primaryAria}
      className="vk-scroll flex items-center gap-1 overflow-x-auto"
    >
      {NAV_ITEMS.map(({ view, label, Icon }) => (
        <a
          key={view}
          href={buildPanelHref(view)}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[4px] border border-transparent px-2.5 text-[0.8125rem] text-[var(--muted-strong)] no-underline"
        >
          <Icon size={14} className="shrink-0 text-[var(--muted)]" />
          <span>{label}</span>
        </a>
      ))}
    </nav>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="vk-shell-frame flex min-h-dvh flex-col bg-[var(--background)] text-[var(--foreground)] lg:h-dvh lg:overflow-hidden">
      <a href="#vk-main-heading" className="visually-hidden vk-skip-link">
        {id.app.skipToMain}
      </a>

      <header className="vk-no-print flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-0)] px-3.5 py-2 sm:px-5">
        <div className="flex min-w-0 flex-wrap items-center gap-4">
          <div className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[4px] border border-[var(--border-strong)] bg-[var(--surface-2)] text-[var(--foreground)]">
              <VisiKartikaMark size={16} />
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-[0.9375rem] font-semibold tracking-[-0.02em] text-[var(--foreground)]">
                {id.app.name}
              </span>
              <span className="hidden text-[0.75rem] text-[var(--muted)] xl:inline">
                · {id.app.subtitle}
              </span>
            </div>
          </div>

          <Suspense fallback={<NavMatrixFallback />}>
            <NavMatrixLinks />
          </Suspense>
        </div>

        <div className="flex items-center gap-2">
          <HealthStrip />
          <ThemeToggle compact />
        </div>
      </header>

      <main
        id="vk-main-workspace"
        tabIndex={-1}
        className="vk-panel-frame flex min-h-0 min-w-0 flex-1 flex-col outline-none lg:overflow-hidden"
      >
        {children}
      </main>
    </div>
  );
}
