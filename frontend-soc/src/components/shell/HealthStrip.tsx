'use client';

/**
 * Indikator ringkas status koneksi mesin pemindai.
 */

import { useEffect, useState } from 'react';
import { getHealth } from '@/lib/api/endpoints';
import { id } from '@/lib/i18n/id';

type EngineState = 'checking' | 'online' | 'offline';

const POLL_MS = 20_000;

export function HealthStrip() {
  const [engine, setEngine] = useState<EngineState>('checking');

  useEffect(() => {
    let cancelled = false;
    let currentAc: AbortController | null = null;

    const probe = async () => {
      currentAc?.abort();
      const ac = new AbortController();
      currentAc = ac;
      try {
        await getHealth(ac.signal);
        if (!cancelled) setEngine('online');
      } catch {
        if (!cancelled) setEngine('offline');
      }
    };

    void probe();
    const timer = setInterval(() => void probe(), POLL_MS);
    return () => {
      cancelled = true;
      currentAc?.abort();
      clearInterval(timer);
    };
  }, []);

  const engineMeta: Record<EngineState, { label: string; color: string }> = {
    checking: { label: id.health.checking, color: 'var(--muted)' },
    online: { label: id.health.online, color: 'var(--verdict-safe)' },
    offline: { label: id.health.offline.trim(), color: 'var(--verdict-critical)' },
  };

  const e = engineMeta[engine];

  return (
    <div
      role="status"
      aria-label={id.health.ariaLabel}
      className="inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-[var(--border)] bg-[var(--surface-1)] px-2.5 text-[0.75rem]"
    >
      <span
        aria-hidden="true"
        className="inline-block h-2 w-2 shrink-0 rounded-full"
        style={{ background: e.color }}
      />
      <span className="text-[var(--muted)]">{id.health.engine}:</span>
      <span className="font-medium text-[var(--foreground)]">{e.label}</span>
    </div>
  );
}
