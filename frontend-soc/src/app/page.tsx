'use client';

import { Suspense, useCallback, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AuditPanel } from '@/components/panels/AuditPanel';
import { CommandPanel } from '@/components/panels/CommandPanel';
import { ForensicsPanel } from '@/components/panels/ForensicsPanel';
import { MitigationPanel } from '@/components/panels/MitigationPanel';
import { ScanConsole } from '@/components/sandbox/ScanConsole';
import { IconForensics } from '@/components/ui/icons';
import { WaSimulator } from '@/components/whatsapp/WaSimulator';
import { id as t } from '@/lib/i18n/id';
import type { NormalizedScan } from '@/lib/normalize';
import { buildPanelHref, readPanelQuery } from '@/lib/panel-route';
import { useIncidentFeed } from '@/lib/supabase/useIncidentFeed';

function ConsoleWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = readPanelQuery(searchParams);

  const feed = useIncidentFeed();
  const [sessionScans, setSessionScans] = useState<NormalizedScan[]>([]);

  const handleScanComplete = useCallback((scan: NormalizedScan) => {
    setSessionScans((prev) => {
      const key = scan.incidentId ?? scan.scanId;
      return [scan, ...prev.filter((item) => (item.incidentId ?? item.scanId) !== key)];
    });
  }, []);

  const mergedIncidents = useMemo(() => {
    const seen = new Set<string>();
    const combined: NormalizedScan[] = [];

    for (const item of [...sessionScans, ...feed.incidents]) {
      const key = item.incidentId ?? item.scanId;
      if (seen.has(key)) continue;
      seen.add(key);
      combined.push(item);
    }

    return combined;
  }, [sessionScans, feed.incidents]);

  switch (query.view) {
    case 'pemindaian':
      return (
        <section className="vk-panel-section">
          <header className="vk-page-header">
            <div>
              <h1
                id="vk-main-heading"
                tabIndex={-1}
                className="text-[1.125rem] leading-[1.25] font-semibold tracking-[-0.02em] text-[var(--foreground)] outline-none sm:text-[1.25rem]"
              >
                {t.scan.title}
              </h1>
              <p className="mt-0.5 text-[0.78rem] text-[var(--muted)]">{t.scan.subtitle}</p>
            </div>

            <button
              type="button"
              onClick={() => router.replace(buildPanelHref('forensik'), { scroll: false })}
              className="vk-btn vk-btn-secondary h-8 shrink-0 px-3 text-[0.78rem]"
            >
              <IconForensics size={14} />
              <span>{t.command.openFullForensics}</span>
            </button>
          </header>

          <div
            data-ui="console-workspace"
            className="vk-scroll flex min-h-0 flex-1 flex-col overflow-y-auto"
          >
            <ScanConsole onScanComplete={handleScanComplete} />
          </div>
        </section>
      );

    case 'forensik':
      return (
        <ForensicsPanel
          requestedId={query.insiden}
          incidents={mergedIncidents}
          onScanUpdated={handleScanComplete}
        />
      );

    case 'audit':
      return <AuditPanel />;

    case 'mitigasi':
      return (
        <MitigationPanel
          incidents={mergedIncidents}
          focusedHost={query.host}
        />
      );

    case 'lapor-cepat':
      return (
        <section className="vk-panel-section">
          <header className="vk-page-header">
            <div>
              <h1
                id="vk-main-heading"
                tabIndex={-1}
                className="text-[1.125rem] leading-[1.25] font-semibold tracking-[-0.02em] text-[var(--foreground)] outline-none sm:text-[1.25rem]"
              >
                {t.whatsapp.pageTitle}
              </h1>
              <p className="mt-0.5 text-[0.78rem] text-[var(--muted)]">
                {t.whatsapp.pageSubtitle}
              </p>
            </div>
          </header>

          <div data-ui="console-workspace" className="flex min-h-0 flex-1 flex-col">
            <WaSimulator onScanComplete={handleScanComplete} />
          </div>
        </section>
      );

    case 'komando':
    default:
      return (
        <CommandPanel
          incidents={mergedIncidents}
          status={feed.status}
          lastEventAt={feed.lastEventAt}
          error={feed.error}
          onRefresh={feed.refresh}
          onScanComplete={handleScanComplete}
        />
      );
  }
}

export default function VisiKartikaConsolePage() {
  return (
    <Suspense
      fallback={
        <section className="vk-panel-section">
          <div className="flex flex-1 items-center justify-center gap-3 p-8 text-[0.875rem] text-[var(--muted-strong)]">
            <span
              aria-hidden="true"
              className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--border-strong)] border-t-[var(--accent-ink)]"
            />
            <span>{t.common.loading}</span>
          </div>
        </section>
      }
    >
      <ConsoleWorkspace />
    </Suspense>
  );
}
