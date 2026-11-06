'use client';

/**
 * Engine + database reachability, and the runtime backend-URL override.
 *
 * Placed in the permanent sidebar footer. Uses useSyncExternalStore so static
 * prerendering (`next build` / `output: 'export'`) stays deterministic without
 * synchronous setState inside effects.
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
        <IconCheck size={13} />
      </span>
    );
  }
  if (state === 'down') {
    return (
      <span className="inline-flex text-[var(--verdict-critical)]" aria-hidden="true">
        <IconAlertTriangle size={13} />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className="inline-block h-2 w-2 shrink-0 rounded-full bg-[var(--muted)]"
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
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] px-2.5 py-2 text-[0.8125rem] text-[var(--muted)]">
        {collapsed ? '…' : id.health.checking}
      </div>
    );
  }

  return (
    <div data-ui="health-telemetry" className="relative">
      {collapsed ? (
        <button
          type="button"
          onClick={toggleOpen}
          aria-expanded={open}
          aria-label={`${id.health.engine}: ${label(engine)}, ${id.health.database}: ${label(db)}`}
          title={`${id.health.engine}: ${label(engine)} · ${id.health.database}: ${label(db)}`}
          className="vk-btn vk-btn-secondary h-10 w-10 p-0"
        >
          <ProbeStatusIcon state={engine === 'up' && db === 'up' ? 'up' : engine} />
        </button>
      ) : (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-2.5">
          <div className="flex flex-col gap-1.5 text-[0.8125rem]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[var(--muted)]">{id.health.engine}</span>
              <span className="inline-flex items-center gap-1.5 font-medium text-[var(--muted-strong)]">
                <ProbeStatusIcon state={engine} />
                <span>{label(engine)}</span>
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[var(--muted)]">{id.health.database}</span>
              <span className="inline-flex items-center gap-1.5 font-medium text-[var(--muted-strong)]">
                <ProbeStatusIcon state={db} />
                <span>{label(db)}</span>
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={toggleOpen}
            aria-expanded={open}
            className="vk-btn vk-btn-secondary mt-2.5 h-8 w-full px-2.5 text-[0.8125rem]"
          >
            <IconSliders size={14} />
            <span>{id.health.backendUrl}</span>
          </button>
        </div>
      )}

      {open && (
        <div className="absolute bottom-full left-0 z-40 mb-2 w-[20rem] rounded-xl border border-[var(--border-strong)] bg-[var(--surface-4)] p-3.5">
          <div className="text-[0.8125rem] font-semibold text-[var(--foreground)]">
            {id.health.backendUrlLabel}
          </div>
          <input
            id="vk-backend-url"
            aria-label={id.health.backendUrlLabel}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') apply();
              if (e.key === 'Escape') setOpen(false);
            }}
            spellCheck={false}
            className="vk-mono mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--canvas)] px-2.5 py-2 text-[0.8125rem] text-[var(--foreground)]"
            placeholder={id.health.backendUrlPlaceholder}
          />
          <div className="mt-2 text-[0.8125rem] leading-snug text-[var(--muted)]">
            {id.health.backendUrlHint}
          </div>
          <div className="vk-mono mt-1.5 truncate text-[0.8125rem] text-[var(--muted-strong)]">
            {id.health.activePrefix} {current}
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={apply}
              className="vk-btn vk-btn-primary h-8 flex-1 px-3 text-[0.8125rem]"
            >
              {id.health.save}
            </button>
            <button
              type="button"
              onClick={reset}
              className="vk-btn vk-btn-secondary h-8 px-3 text-[0.8125rem]"
            >
              {id.health.reset}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
