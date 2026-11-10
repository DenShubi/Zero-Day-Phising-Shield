'use client';

import { Suspense, useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AuditPanel } from '@/components/panels/AuditPanel';
import { ForensicsPanel } from '@/components/panels/ForensicsPanel';
import { OverviewPanel } from '@/components/panels/OverviewPanel';
import { ResponsePanel } from '@/components/panels/ResponsePanel';
import { id as t } from '@/lib/i18n/id';
import type { NormalizedScan } from '@/lib/normalize';
import { readPanelQuery } from '@/lib/panel-route';
import { useIncidentFeed } from '@/lib/supabase/useIncidentFeed';

function ConsoleWorkspace() {
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
    case 'forensik':
      return (
        <ForensicsPanel
          requestedId={query.insiden}
          incidents={mergedIncidents}
          onScanUpdated={handleScanComplete}
        />
      );

    case 'respons':
      return (
        <ResponsePanel
          tab={query.tab}
          incidents={mergedIncidents}
          focusedHost={query.host}
          onScanComplete={handleScanComplete}
        />
      );

    case 'evaluasi':
      return <AuditPanel />;

    case 'beranda':
    default:
      return (
        <OverviewPanel
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
              className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--accent)]"
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
