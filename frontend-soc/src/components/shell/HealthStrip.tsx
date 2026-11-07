'use client';

/**
 * Engine API + Supabase reachability ledger and runtime backend-URL override.
 * Placed in the sidebar footer with deterministic SSR via useSyncExternalStore.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getBackendUrl, setBackendUrl } from '@/lib/api/client';
import { getHealth, getSupabaseStatus } from '@/lib/api/endpoints';
import { id } from '@/lib/i18n/id';
import { IconAlertTriangle, IconCheck, IconSliders } from '@/components/ui/icons';

type Probe = 'checking' | 'up' | 'down';

const POLL_MS = 15_000;
const subscribeNoop = () => () => {};

function ProbeStatusIcon({ state }: { state: Probe }) {
  if (state === 'up') {
    return (
      <span className="inline-flex text-[var(--verdict-safe)]" aria-hidden="true">
        <IconCheck size={12} />
      </span>
    );
  }
  if (state === 'down') {
    return (
      <span className="inline-flex text-[var(--verdict-critical)]" aria-hidden="true">
        <IconAlertTriangle size={12} />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className="inline-block h-1.5 w-1.5 shrink-0 bg-[var(--muted)]"
    />
  );
}

export function HealthStrip({ collapsed = false }: { collapsed?: boolean }) {
  const mounted = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
  const [engine, setEngine] = useState<Probe>('checking');
  const [db, setDb] = useState<Probe>('checking');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [overrideCurrent, setOverrideCurrent] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const current = overrideCurrent ?? (mounted ? getBackendUrl() : '');

  const probe = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const h = await getHealth(ac.signal);
      if (ac.signal.aborted) return;
      setEngine(h.status === 'healthy' ? 'up' : 'down');
      try {
        const s = await getSupabaseStatus(ac.signal);
        if (!ac.signal.aborted) setDb(s.connected ? 'up' : 'down');
      } catch {
        if (!ac.signal.aborted) setDb('down');
      }
    } catch {
      if (!ac.signal.aborted) {
        setEngine('down');
        setDb('down');
      }
    }
  }, []);

  useEffect(() => {
    const initial = setTimeout(() => void probe(), 0);
    const timer = setInterval(() => void probe(), POLL_MS);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
      abortRef.current?.abort();
    };
  }, [probe]);

  const toggleOpen = () => {
    setOpen((prev) => {
      const nextOpen = !prev;
      if (nextOpen) {
        setDraft(getBackendUrl());
      }
      return nextOpen;
    });
  };

  const apply = () => {
    setBackendUrl(draft.trim() === '' ? null : draft);
    const next = getBackendUrl();
    setOverrideCurrent(next);
    setDraft(next);
    setOpen(false);
    setEngine('checking');
    setDb('checking');
    void probe();
  };

  const reset = () => {
    setBackendUrl(null);
    const next = getBackendUrl();
    setOverrideCurrent(next);
    setDraft(next);
    setEngine('checking');
    setDb('checking');
    void probe();
  };

  const label = (state: Probe) =>
    state === 'up' ? id.health.online : state === 'down' ? id.health.offline : id.health.checking;

  if (!mounted) {
    return (
      <div className="rounded-[4px] border border-[var(--border)] bg-[var(--surface-1)] px-2.5 py-1.5 text-[0.75rem] text-[var(--muted)]">
        {collapsed ? '...' : id.health.checking}
      </div>
    );
  }

  return (
    <div data-ui="health-telemetry" className="relative w-full">
      {collapsed ? (
        <button
          type="button"
          onClick={toggleOpen}
          aria-expanded={open}
          aria-label={`${id.health.engine}: ${label(engine)}, ${id.health.database}: ${label(db)}`}
          title={`${id.health.engine}: ${label(engine)} · ${id.health.database}: ${label(db)}`}
          className="vk-btn vk-btn-secondary mx-auto flex h-8 w-8 p-0"
        >
          <ProbeStatusIcon state={engine === 'up' && db === 'up' ? 'up' : engine} />
        </button>
      ) : (
        <div className="rounded-[4px] border border-[var(--border)] bg-[var(--surface-1)]">
          <div className="divide-y divide-[var(--border-subtle)] text-[0.75rem]">
            <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
              <span className="text-[var(--muted)]">{id.health.engine}</span>
              <span className="vk-mono inline-flex items-center gap-1 font-medium text-[var(--foreground)]">
                <ProbeStatusIcon state={engine} />
                <span>{label(engine)}</span>
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
              <span className="text-[var(--muted)]">{id.health.database}</span>
              <span className="vk-mono inline-flex items-center gap-1 font-medium text-[var(--foreground)]">
                <ProbeStatusIcon state={db} />
                <span>{label(db)}</span>
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={toggleOpen}
            aria-expanded={open}
            className="flex h-7 w-full items-center justify-center gap-1.5 border-t border-[var(--border)] bg-[var(--surface-2)] px-2 text-[0.75rem] font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--surface-3)]"
          >
            <IconSliders size={12} />
            <span>{id.health.backendUrl}</span>
          </button>
        </div>
      )}

      {open && (
        <div
          role="dialog"
          aria-labelledby="vk-backend-dialog-title"
          className="absolute bottom-full left-0 z-40 mb-2 w-[19rem] rounded-[4px] border border-[var(--border-strong)] bg-[var(--surface-4)] p-3"
        >
          <label
            id="vk-backend-dialog-title"
            htmlFor="vk-backend-url"
            className="block text-[0.75rem] font-semibold text-[var(--foreground)]"
          >
            {id.health.backendUrlLabel}
          </label>
          <input
            id="vk-backend-url"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') apply();
              if (e.key === 'Escape') setOpen(false);
            }}
            spellCheck={false}
            className="vk-mono mt-1.5 h-8 w-full rounded-[4px] border border-[var(--border-strong)] bg-[var(--canvas)] px-2.5 text-[0.75rem] text-[var(--foreground)]"
            placeholder={id.health.backendUrlPlaceholder}
          />
          <p className="mt-1.5 text-[0.75rem] leading-snug text-[var(--muted)]">
            {id.health.backendUrlHint}
          </p>
          <div className="vk-mono mt-1 truncate text-[0.6875rem] text-[var(--muted-strong)]">
            {id.health.activePrefix} {current}
          </div>
          <div className="mt-2.5 flex gap-1.5">
            <button
              type="button"
              onClick={apply}
              className="vk-btn vk-btn-primary h-7 flex-1 px-2.5 text-[0.75rem]"
            >
              {id.health.save}
            </button>
            <button
              type="button"
              onClick={reset}
              className="vk-btn vk-btn-secondary h-7 px-2.5 text-[0.75rem]"
            >
              {id.health.reset}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
