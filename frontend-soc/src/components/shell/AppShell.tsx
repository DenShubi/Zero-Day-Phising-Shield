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
    <nav className="flex flex-col gap-5" aria-label={id.nav.ariaMain}>
      {NAV_GROUPS.map((group) => (
        <div key={group.key} className="flex flex-col gap-1">
          {!collapsed && (
            <div className="pb-1 text-[0.8125rem] font-medium tracking-[0.02em] text-[var(--muted)]">
              {group.title}
            </div>
          )}
          <ul className="flex flex-col gap-1">
            {group.items.map(({ view, label, Icon }) => {
              const active = activeQuery.view === view;
              // Preserve active incident context when returning to Forensik.
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
                      'group relative flex items-center rounded-md text-[0.875rem] font-medium no-underline transition-colors duration-150',
                      collapsed ? 'mx-auto h-10 w-10 justify-center p-0' : 'gap-2.5 px-2.5 py-2',
                      active
                        ? 'font-semibold text-[var(--foreground)]'
                        : 'text-[var(--muted-strong)] hover:text-[var(--foreground)]',
                    ].join(' ')}
                  >
                    {active && !collapsed && (
                      <span
                        aria-hidden="true"
                        className="absolute inset-y-1.5 left-0 w-[2px] rounded-full bg-[var(--accent-ink)]"
                      />
                    )}
                    <span
                      className={
                        active
                          ? 'text-[var(--accent-ink)]'
                          : 'text-[var(--muted)] transition-colors duration-150 group-hover:text-[var(--foreground)]'
                      }
                    >
                      <Icon size={18} />
                    </span>
                    {!collapsed && <span className="truncate">{label}</span>}
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
    <nav className="flex flex-col gap-5" aria-label={id.nav.ariaMain}>
      {NAV_GROUPS.map((group) => (
        <div key={group.key} className="flex flex-col gap-1">
          {!collapsed && (
            <div className="pb-1 text-[0.8125rem] font-medium tracking-[0.02em] text-[var(--muted)]">
              {group.title}
            </div>
          )}
          <ul className="flex flex-col gap-1">
            {group.items.map(({ view, label, Icon }) => (
              <li key={view}>
                <a
                  href={buildPanelHref(view)}
                  className={[
                    'flex items-center rounded-md text-[0.875rem] font-medium text-[var(--muted-strong)] no-underline',
                    collapsed ? 'mx-auto h-10 w-10 justify-center p-0' : 'gap-2.5 px-2.5 py-2',
                  ].join(' ')}
                >
                  <Icon size={18} />
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
      {/* Mobile & Tablet Fixed Top Bar (< 1024px) */}
      <header className="vk-no-print fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface-0)] px-4 lg:hidden">
        <Link
          href="/"
          onClick={goHome}
          className="group flex min-w-0 items-center gap-2.5 whitespace-nowrap no-underline"
        >
          <VisiKartikaMark size={24} />
          <span className="text-[0.9375rem] font-semibold tracking-[-0.025em] text-[var(--foreground)] transition-colors duration-150 group-hover:text-[var(--accent-ink)]">
            {id.app.name}
          </span>
        </Link>

        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          aria-expanded={mobileOpen}
          aria-label={mobileOpen ? id.nav.closeMenu : id.nav.openMenu}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-transparent text-[var(--foreground)] transition-colors duration-150 hover:bg-[var(--surface-2)]"
        >
          {mobileOpen ? <IconClose size={17} /> : <IconMenu size={17} />}
        </button>
      </header>

      {/* Mobile & Tablet Slide-over Drawer */}
      {mobileOpen && (
        <div className="vk-no-print fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-black/70"
            aria-hidden="true"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative z-10 flex h-full w-[264px] flex-col justify-between border-r border-[var(--border)] bg-[var(--surface-0)] p-4">
            <div className="flex flex-col gap-5">
              <div className="flex items-center justify-between gap-2">
                <Link
                  href="/"
                  onClick={goHome}
                  className="group flex items-center gap-2.5 whitespace-nowrap no-underline"
                >
                  <VisiKartikaMark size={24} />
                  <span className="text-[0.9375rem] font-semibold tracking-[-0.025em] text-[var(--foreground)] transition-colors duration-150 group-hover:text-[var(--accent-ink)]">
                    {id.app.name}
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={() => setMobileOpen(false)}
                  aria-label={id.nav.closeMenu}
                  className="vk-btn vk-btn-secondary h-8 w-8 p-0"
                >
                  <IconClose size={15} />
                </button>
              </div>

              <Suspense fallback={<SidebarFallback collapsed={false} />}>
                <SidebarNavigation collapsed={false} onNavigate={() => setMobileOpen(false)} />
              </Suspense>
            </div>

            <div className="flex flex-col gap-2.5 border-t border-[var(--border-subtle)] pt-3">
              <HealthStrip collapsed={false} />
              <div className="text-[0.8125rem] text-[var(--muted)]">{id.app.org}</div>
            </div>
          </aside>
        </div>
      )}

      {/* Permanent Desktop Left Sidebar (>= 1024px) */}
      <aside
        className={[
          'vk-no-print hidden border-r border-[var(--border)] bg-[var(--surface-0)] transition-[width] duration-150 lg:flex lg:h-[100svh] lg:flex-col lg:justify-between',
          collapsed ? 'w-16 px-2 py-4' : 'w-[252px] px-4 py-4',
        ].join(' ')}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-6">
          <header
            className={[
              'flex items-center',
              collapsed ? 'flex-col gap-2.5' : 'justify-between gap-2',
            ].join(' ')}
          >
            <Link
              href="/"
              onClick={goHome}
              title={id.app.name}
              className="group flex min-w-0 items-center gap-3 no-underline transition-colors duration-150 hover:text-[var(--accent-ink)]"
            >
              <VisiKartikaMark size={26} />
              {!collapsed && (
                <span className="truncate text-[0.9375rem] font-semibold tracking-[-0.025em] text-[var(--foreground)] transition-colors duration-150 group-hover:text-[var(--accent-ink)]">
                  {id.app.name}
                </span>
              )}
            </Link>

            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label={collapsed ? id.nav.expandRail : id.nav.collapseRail}
              title={collapsed ? id.nav.expandRail : id.nav.collapseRail}
              className="vk-btn vk-btn-secondary h-8 w-8 shrink-0 p-0"
            >
              {collapsed ? <IconSidebarExpand size={15} /> : <IconSidebarCollapse size={15} />}
            </button>
          </header>

          <div className="vk-scroll min-h-0 flex-1 overflow-y-auto">
            <Suspense fallback={<SidebarFallback collapsed={collapsed} />}>
              <SidebarNavigation collapsed={collapsed} />
            </Suspense>
          </div>
        </div>

        <div
          className={[
            'flex flex-col gap-2.5 border-t border-[var(--border-subtle)] pt-3',
            collapsed ? 'items-center' : '',
          ].join(' ')}
        >
          <HealthStrip collapsed={collapsed} />
          {!collapsed && (
            <div className="text-[0.8125rem] text-[var(--muted)]">{id.app.org}</div>
          )}
        </div>
      </aside>

      {/* Main Content Stage (Zero frame scroll on desktop 1440x900) */}
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
