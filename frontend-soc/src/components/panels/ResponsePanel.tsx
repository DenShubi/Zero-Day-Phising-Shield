'use client';

/**
 * Respons - what happens after a verdict.
 *
 * Blocklist export and the WhatsApp intake simulator each used to hold a tab
 * of their own and each filled about half a screen. They are two answers to
 * the same question, so they share one tab and a segmented control.
 */

import { useCallback, type MouseEvent } from 'react';
import { useRouter } from 'next/navigation';
import { MitigationPanel } from './MitigationPanel';
import { WaSimulator } from '@/components/whatsapp/WaSimulator';
import { IconMitigation, IconWhatsapp } from '@/components/ui/icons';
import { id as t } from '@/lib/i18n/id';
import type { NormalizedScan } from '@/lib/normalize';
import { buildPanelHref, type ResponseTab } from '@/lib/panel-route';

const TABS: readonly {
  key: ResponseTab;
  label: string;
  Icon: typeof IconMitigation;
}[] = [
  { key: 'blokir', label: t.nav.responseBlock, Icon: IconMitigation },
  { key: 'wa', label: t.nav.responseWa, Icon: IconWhatsapp },
] as const;

export function ResponsePanel({
  tab,
  incidents,
  focusedHost,
  onScanComplete,
}: {
  tab: ResponseTab;
  incidents: readonly NormalizedScan[];
  focusedHost: string | null;
  onScanComplete?: (scan: NormalizedScan) => void;
}) {
  const router = useRouter();

  const switchTab = useCallback(
    (e: MouseEvent<HTMLAnchorElement>, next: ResponseTab, href: string) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      if (next === tab) return;
      router.replace(href, { scroll: false });
    },
    [router, tab],
  );

  return (
    <section className="vk-panel-section">
      <h1 id="vk-main-heading" tabIndex={-1} className="visually-hidden">
        {t.response.pageTitle}
      </h1>

      <div className="vk-page-header vk-no-print">
        <nav aria-label={t.nav.responseAria} className="vk-nav-track">
          {TABS.map(({ key, label, Icon }) => {
            const href = buildPanelHref('respons', {
              tab: key,
              host: key === 'blokir' ? focusedHost : null,
            });
            const active = tab === key;
            return (
              <a
                key={key}
                href={href}
                aria-current={active ? 'page' : undefined}
                onClick={(e) => switchTab(e, key, href)}
                className="vk-nav-tab"
              >
                <Icon
                  size={14}
                  className={active ? 'text-[var(--accent)]' : 'text-[var(--muted)]'}
                />
                <span>{label}</span>
              </a>
            );
          })}
        </nav>
      </div>

      {tab === 'wa' ? (
        <WaSimulator onScanComplete={onScanComplete} />
      ) : (
        <MitigationPanel incidents={incidents} focusedHost={focusedHost} />
      )}
    </section>
  );
}
