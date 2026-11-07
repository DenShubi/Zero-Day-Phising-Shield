'use client';

import {
  Suspense,
  useCallback,
  useState,
  useSyncExternalStore,
  type MouseEvent,
} from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { id } from '@/lib/i18n/id';
import { buildPanelHref, readPanelQuery, type PanelId } from '@/lib/panel-route';
import {
  IconAudit,
  IconClose,
  IconCommand,
  IconForensics,
  IconMenu,
  IconMitigation,
  IconScan,
  IconSidebarCollapse,
  IconSidebarExpand,
  IconWhatsapp,
  VisiKartikaMark,
} from '@/components/ui/icons';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { HealthStrip } from './HealthStrip';

interface NavItem {
  view: PanelId;
  label: string;
  Icon: typeof IconCommand;
}

interface NavGroup {
  key: string;
  title: string;
  items: readonly NavItem[];
}

const NAV_GROUPS: readonly NavGroup[] = [
  {
    key: 'operations',
    title: id.navGroups.operations,
    items: [
      { view: 'komando', label: id.nav.command, Icon: IconCommand },
      { view: 'pemindaian', label: id.nav.sandbox, Icon: IconScan },
    ],
  },
  {
    key: 'analysis',
    title: id.navGroups.analysis,
    items: [
      { view: 'forensik', label: id.nav.forensics, Icon: IconForensics },
      { view: 'audit', label: id.nav.audit, Icon: IconAudit },
    ],
  },
  {
    key: 'actions',
    title: id.navGroups.actions,
    items: [
      { view: 'mitigasi', label: id.nav.mitigation, Icon: IconMitigation },
      { view: 'lapor-cepat', label: id.nav.whatsapp, Icon: IconWhatsapp },
    ],
  },
] as const;

const RAIL_STORAGE_KEY = 'vk:sidebar:collapsed';

function SidebarNavigation({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeQuery = readPanelQuery(searchParams);

  const handleLinkClick = useCallback(
    (e: MouseEvent<HTMLAnchorElement>, href: string) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
        return;
      }
      e.preventDefault();
      router.replace(href, { scroll: false });
      onNavigate?.();
    },
    [router, onNavigate],
  );

  return (
    <nav className="flex flex-col gap-4" aria-label={id.nav.ariaMain}>
      {NAV_GROUPS.map((group) => (
        <div key={group.key} className="flex flex-col gap-1">
          {!collapsed && (
            <div className="vk-kicker px-2 pb-1">
              {group.title}
            </div>
          )}
          <ul className="flex flex-col gap-0.5">
            {group.items.map(({ view, label, Icon }) => {
              const active = activeQuery.view === view;
              const href =
                view === 'forensik' && activeQuery.insiden
                  ? buildPanelHref('forensik', { insiden: activeQuery.insiden })
                  : buildPanelHref(view);

              return (
                <li key={view}>
                  <a
                    href={href}
                    onClick={(e) => handleLinkClick(e, href)}
                    aria-current={active ? 'page' : undefined}
                    title={collapsed ? label : undefined}
                    className={[
                      'group flex items-center rounded-[4px] border text-[0.8125rem] no-underline transition-colors duration-100',
                      collapsed
                        ? 'mx-auto h-9 w-9 justify-center p-0'
                        : 'justify-between gap-2 px-2.5 py-1.5',
                      active
                        ? 'border-[var(--border-strong)] bg-[var(--surface-3)] font-semibold text-[var(--foreground)]'
                        : 'border-transparent font-medium text-[var(--muted-strong)] hover:border-[var(--border)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]',
                    ].join(' ')}
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span
                        className={
                          active
                            ? 'text-[var(--foreground)]'
                            : 'text-[var(--muted)] transition-colors duration-100 group-hover:text-[var(--foreground)]'
                        }
                      >
                        <Icon size={16} />
                      </span>
                      {!collapsed && <span className="truncate">{label}</span>}
                    </span>

                    {active && !collapsed && (
                      <span
                        aria-hidden="true"
                        className="h-1.5 w-1.5 shrink-0 bg-[var(--accent-ink)]"
                      />
                    )}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function SidebarFallback({ collapsed }: { collapsed: boolean }) {
  return (
    <nav className="flex flex-col gap-4" aria-label={id.nav.ariaMain}>
      {NAV_GROUPS.map((group) => (
        <div key={group.key} className="flex flex-col gap-1">
          {!collapsed && <div className="vk-kicker px-2 pb-1">{group.title}</div>}
          <ul className="flex flex-col gap-0.5">
            {group.items.map(({ view, label, Icon }) => (
              <li key={view}>
                <a
                  href={buildPanelHref(view)}
                  className={[
                    'flex items-center rounded-[4px] border border-transparent text-[0.8125rem] font-medium text-[var(--muted-strong)] no-underline',
                    collapsed ? 'mx-auto h-9 w-9 justify-center p-0' : 'gap-2.5 px-2.5 py-1.5',
                  ].join(' ')}
                >
                  <Icon size={16} />
                  {!collapsed && <span className="truncate">{label}</span>}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function readStoredCollapsed(): boolean {
  try {
    return localStorage.getItem(RAIL_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const isClient = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [userCollapsed, setUserCollapsed] = useState<boolean | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  const collapsed = userCollapsed ?? (isClient ? readStoredCollapsed() : false);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setUserCollapsed(next);
    try {
      localStorage.setItem(RAIL_STORAGE_KEY, next ? '1' : '0');
    } catch {
      // Ignore storage access errors in restricted environments.
    }
  };

  const goHome = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    router.replace('/', { scroll: false });
    setMobileOpen(false);
  };

  return (
    <div className="vk-shell-frame flex min-h-[100svh] flex-col bg-[var(--canvas)] lg:grid lg:h-[100svh] lg:grid-cols-[auto_minmax(0,1fr)] lg:overflow-hidden">
      {/* Keyboard Skip Link */}
      <a href="#vk-main-heading" className="visually-hidden vk-skip-link vk-no-print">
        {id.app.skipToContent}
      </a>

      {/* Mobile & Tablet Fixed Top Bar (< 1024px) */}
      <header className="vk-no-print fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface-0)] px-3.5 lg:hidden">
        <Link
          href="/"
          onClick={goHome}
          className="group flex min-w-0 items-center gap-2.5 whitespace-nowrap no-underline"
        >
          <VisiKartikaMark size={22} />
          <span className="text-[0.875rem] font-semibold tracking-[-0.02em] text-[var(--foreground)]">
            {id.app.name}
          </span>
        </Link>

        <div className="flex items-center gap-1.5">
          <ThemeToggle compact />
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            aria-expanded={mobileOpen}
            aria-label={mobileOpen ? id.nav.closeMenu : id.nav.openMenu}
            className="vk-btn vk-btn-secondary h-8 w-8 p-0"
          >
            {mobileOpen ? <IconClose size={15} /> : <IconMenu size={15} />}
          </button>
        </div>
      </header>

      {/* Mobile & Tablet Slide-over Drawer */}
      {mobileOpen && (
        <div
          className="vk-no-print fixed inset-0 z-50 flex lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label={id.nav.ariaMain}
        >
          <div
            className="fixed inset-0 bg-black/65"
            aria-hidden="true"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative z-10 flex h-full w-[248px] flex-col justify-between border-r border-[var(--border)] bg-[var(--surface-0)]">
            <div className="flex flex-col">
              <div className="flex h-14 items-center justify-between gap-2 border-b border-[var(--border)] px-3.5">
                <Link
                  href="/"
                  onClick={goHome}
                  className="flex items-center gap-2.5 whitespace-nowrap no-underline"
                >
                  <VisiKartikaMark size={22} />
                  <span className="text-[0.875rem] font-semibold tracking-[-0.02em] text-[var(--foreground)]">
                    {id.app.name}
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={() => setMobileOpen(false)}
                  aria-label={id.nav.closeMenu}
                  className="vk-btn vk-btn-secondary h-8 w-8 p-0"
                >
                  <IconClose size={14} />
                </button>
              </div>

              <div className="p-3">
                <Suspense fallback={<SidebarFallback collapsed={false} />}>
                  <SidebarNavigation collapsed={false} onNavigate={() => setMobileOpen(false)} />
                </Suspense>
              </div>
            </div>

            <div className="flex flex-col gap-2 border-t border-[var(--border)] p-3">
              <ThemeToggle />
              <HealthStrip collapsed={false} />
              <div className="vk-mono text-[0.6875rem] tracking-[0.04em] text-[var(--muted)]">
                {id.app.org}
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* Permanent Desktop Architectural Left Rail (>= 1024px) */}
      <aside
        className={[
          'vk-no-print hidden border-r border-[var(--border)] bg-[var(--surface-0)] transition-[width] duration-150 lg:flex lg:h-[100svh] lg:flex-col lg:justify-between',
          collapsed ? 'w-[56px]' : 'w-[236px]',
        ].join(' ')}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Flush Top Brand Cell matching main header rhythm */}
          <div
            className={[
              'flex shrink-0 items-center border-b border-[var(--border)]',
              collapsed ? 'flex-col gap-2 py-2.5' : 'h-[57px] justify-between gap-2 px-3.5',
            ].join(' ')}
          >
            <Link
              href="/"
              onClick={goHome}
              title={id.app.name}
              className="group flex min-w-0 items-center gap-2.5 no-underline"
            >
              <VisiKartikaMark size={22} />
              {!collapsed && (
                <span className="truncate text-[0.875rem] font-semibold tracking-[-0.02em] text-[var(--foreground)]">
                  {id.app.name}
                </span>
              )}
            </Link>

            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label={collapsed ? id.nav.expandRail : id.nav.collapseRail}
              title={collapsed ? id.nav.expandRail : id.nav.collapseRail}
              className="vk-btn vk-btn-ghost h-7 w-7 shrink-0 p-0"
            >
              {collapsed ? <IconSidebarExpand size={14} /> : <IconSidebarCollapse size={14} />}
            </button>
          </div>

          <div
            className={[
              'vk-scroll min-h-0 flex-1 overflow-y-auto',
              collapsed ? 'px-1.5 py-3' : 'px-2.5 py-3.5',
            ].join(' ')}
          >
            <Suspense fallback={<SidebarFallback collapsed={collapsed} />}>
              <SidebarNavigation collapsed={collapsed} />
            </Suspense>
          </div>
        </div>

        <div
          className={[
            'flex flex-col gap-2 border-t border-[var(--border)]',
            collapsed ? 'items-center px-1.5 py-2.5' : 'p-3',
          ].join(' ')}
        >
          <ThemeToggle compact={collapsed} />
          <HealthStrip collapsed={collapsed} />
          {!collapsed && (
            <div className="vk-mono pt-0.5 text-[0.6875rem] tracking-[0.04em] text-[var(--muted)]">
              {id.app.org}
            </div>
          )}
        </div>
      </aside>

      {/* Main Content Stage */}
      <div className="vk-panel-frame flex min-h-0 min-w-0 flex-1 flex-col lg:h-[100svh] lg:overflow-hidden">
        {/* Print-only Official Document Header */}
        <div className="vk-print-only mb-4 border-b border-[#cbd5e1] pb-3">
          <div className="text-[1.125rem] font-semibold text-[#0f172a]">
            {id.app.printReportHeader}
          </div>
          <div className="text-[0.8125rem] text-[#475569]">{id.app.org}</div>
        </div>

        <main className="flex min-h-[100svh] min-w-0 flex-1 flex-col p-0 lg:h-[100svh] lg:overflow-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}
