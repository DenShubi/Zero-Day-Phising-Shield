'use client';

/**
 * Application chrome: one floating window on a tinted canvas, with a single
 * row of chrome at the top. Four tabs, no page titles underneath them - the
 * active tab already names the view, so repeating it in an <h1> plus a
 * one-line explanation was pure duplication.
 */

import { Suspense, useCallback, type ComponentType, type MouseEvent } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { id } from '@/lib/i18n/id';
import { buildPanelHref, parsePanelView, type PanelId } from '@/lib/panel-route';
import { HealthStrip } from './HealthStrip';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { BrandMark } from '@/components/ui/BrandMark';
import {
  IconAudit,
  IconCommand,
  IconForensics,
  IconMitigation,
} from '@/components/ui/icons';

interface NavSpec {
  view: PanelId;
  label: string;
  Icon: ComponentType<{ size?: number; className?: string }>;
}

const NAV_ITEMS: readonly NavSpec[] = [
  { view: 'beranda', label: id.nav.overview, Icon: IconCommand },
  { view: 'forensik', label: id.nav.forensics, Icon: IconForensics },
  { view: 'respons', label: id.nav.response, Icon: IconMitigation },
  { view: 'evaluasi', label: id.nav.audit, Icon: IconAudit },
] as const;

function NavTab({
  spec,
  active,
  onClick,
}: {
  spec: NavSpec;
  active: boolean;
  onClick?: (e: MouseEvent<HTMLAnchorElement>, view: PanelId, href: string) => void;
}) {
  const href = buildPanelHref(spec.view);
  const { Icon, label } = spec;

  return (
    <a
      href={href}
      aria-current={active ? 'page' : undefined}
      onClick={onClick ? (e) => onClick(e, spec.view, href) : undefined}
      className="vk-nav-tab justify-center"
    >
      <Icon
        size={14}
        className={active ? 'text-[var(--accent)]' : 'text-[var(--muted)]'}
      />
      <span className="truncate">{label}</span>
    </a>
  );
}

function NavTrack({ activeView }: { activeView: PanelId | null }) {
  const pathname = usePathname();
  const router = useRouter();

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
    <nav aria-label={id.nav.primaryAria} className="vk-scroll w-full max-w-full overflow-x-auto md:w-auto">
      <div className="vk-nav-track grid w-full grid-cols-4 md:flex md:w-max">
        {NAV_ITEMS.map((spec) => (
          <NavTab
            key={spec.view}
            spec={spec}
            active={pathname === '/' && activeView === spec.view}
            onClick={handleNavClick}
          />
        ))}
      </div>
    </nav>
  );
}

function LiveNavTrack() {
  const searchParams = useSearchParams();
  return <NavTrack activeView={parsePanelView(searchParams.get('view'))} />;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="vk-shell-frame flex min-h-dvh flex-col p-0 sm:p-3 lg:h-dvh lg:p-4">
      <a href="#vk-main-heading" className="visually-hidden vk-skip-link">
        {id.app.skipToMain}
      </a>

      <div className="vk-app-window flex min-h-0 flex-1 flex-col">
        {/* Below md the three groups wrap to two rows, with the nav on its own
            full-width line instead of being squeezed out of the bar. */}
        <header className="vk-topbar vk-no-print">
          <div className="order-1 flex min-w-0 flex-1 items-center gap-2.5">
            <BrandMark />
            <span className="truncate text-[0.9375rem] font-semibold tracking-[-0.015em] text-[var(--foreground)]">
              {id.app.name}
            </span>
          </div>

          <div className="order-2 flex items-center gap-1.5 md:order-3 md:flex-1 md:justify-end">
            <HealthStrip />
            <ThemeToggle />
          </div>

          <div className="order-3 w-full min-w-0 md:order-2 md:w-auto">
            <Suspense fallback={<NavTrack activeView={null} />}>
              <LiveNavTrack />
            </Suspense>
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
    </div>
  );
}
