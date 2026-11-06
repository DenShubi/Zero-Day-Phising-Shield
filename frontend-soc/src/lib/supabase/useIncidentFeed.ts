'use client';

/**
 * Live incident feed.
 *
 * The table is already published for realtime
 * (supabase/migrations/20261101_initial_schema.sql runs
 *  ALTER PUBLICATION supabase_realtime ADD TABLE scan_incidents),
 * so this needs no backend work.
 *
 * The parts that are easy to get wrong, and what is done about each:
 *
 *  - Race between history and stream. An INSERT can arrive before or after the
 *    initial query resolves. Rows are merged into a Map keyed by id, so either
 *    order converges and nothing duplicates.
 *  - Gap while disconnected. Rows inserted while the socket was down would be
 *    lost forever, so every (re)subscribe re-queries with gte(created_at) and
 *    back-fills. gte rather than gt, because a row sharing the newest timestamp
 *    would otherwise be skipped; the id-keyed merge absorbs the overlap.
 *  - Unstable ordering. Two inserts in the same millisecond would swap places
 *    between renders, so id breaks the tie.
 *  - StrictMode double-mount. A disposed flag makes the discarded first pass
 *    inert instead of leaving an orphaned channel behind.
 *  - Sleeping laptops. Sockets die silently mid-demo, so the feed re-syncs on
 *    visibilitychange and on the online event.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { INCIDENTS_TABLE, getSupabase, isSupabaseConfigured } from './client';
import { normalizeIncident, type IncidentRow, type NormalizedScan } from '../normalize';
import { getIncidents } from '../api/endpoints';

export type FeedStatus = 'connecting' | 'live' | 'reconnecting' | 'offline' | 'unconfigured';

const PAGE_SIZE = 50;
const MAX_ROWS = 200;
const MAX_BACKOFF_MS = 15_000;

/** Newest first; id breaks same-millisecond ties so ordering never flickers. */
function byRecencyDesc(a: NormalizedScan, b: NormalizedScan): number {
  return b.createdAtMs - a.createdAtMs || b.scanId.localeCompare(a.scanId);
}

export interface IncidentFeed {
  incidents: NormalizedScan[];
  status: FeedStatus;
  lastEventAt: number | null;
  error: string | null;
  refresh: () => void;
}

export function useIncidentFeed(): IncidentFeed {
  const configured = useMemo(() => isSupabaseConfigured(), []);

  const [store, setStore] = useState<ReadonlyMap<string, NormalizedScan>>(() => new Map());
  const [status, setStatus] = useState<FeedStatus>(configured ? 'connecting' : 'unconfigured');
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const incidents = useMemo(() => [...store.values()].sort(byRecencyDesc), [store]);

  // Non-reactive mirror, so socket callbacks never close over a stale value and
  // the channel does not need recreating every time a row lands.
  const newestIsoRef = useRef<string | null>(null);
  useEffect(() => {
    newestIsoRef.current = incidents[0]?.createdAtIso ?? null;
  }, [incidents]);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const backoffRef = useRef(1_000);
  const disposedRef = useRef(false);
  const inFlightRef = useRef(false);

  const merge = useCallback((incoming: readonly NormalizedScan[]) => {
    if (incoming.length === 0) return;
    setStore((prev) => {
      const next = new Map(prev);
      for (const inc of incoming) next.set(inc.scanId, inc);
      if (next.size <= MAX_ROWS) return next;
      const kept = [...next.values()].sort(byRecencyDesc).slice(0, MAX_ROWS);
      return new Map(kept.map((i) => [i.scanId, i] as const));
    });
  }, []);

  /** Initial load and post-reconnect gap-fill are the same operation. */
  const catchUp = useCallback(async () => {
    if (inFlightRef.current || disposedRef.current) return;
    inFlightRef.current = true;
    try {
      if (!configured) {
        // No Supabase: fall back to the engine's own incidents endpoint so the
        // feed still shows history, just without live updates.
        merge(await getIncidents(PAGE_SIZE));
      } else {
        const supabase = getSupabase();
        let q = supabase
          .from(INCIDENTS_TABLE)
          .select('*')
          .order('created_at', { ascending: false })
          .limit(PAGE_SIZE);
        const since = newestIsoRef.current;
        if (since) q = q.gte('created_at', since);
        const { data, error: err } = await q;
        if (err) throw new Error(err.message);
        merge(((data as IncidentRow[] | null) ?? []).map(normalizeIncident));
      }
      if (!disposedRef.current) setError(null);
    } catch (e) {
      if (!disposedRef.current) {
        setError(e instanceof Error ? e.message : 'Gagal memuat insiden');
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [configured, merge]);

  useEffect(() => {
    disposedRef.current = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    // Without Supabase there is no socket to manage - load history and stop.
    if (!configured) {
      // catchUp() is async: its setState calls land in a later microtask, not
      // synchronously in this effect body, so the cascading-render this rule
      // guards against cannot happen here. setStatus below is the terminal
      // state for this branch - `configured` never flips within a session.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void catchUp();
      setStatus('unconfigured');
      return () => {
        disposedRef.current = true;
      };
    }

    const supabase = getSupabase();

    const scheduleReconnect = () => {
      if (disposedRef.current || retryTimer) return;
      const delay = backoffRef.current;
      backoffRef.current = Math.min(delay * 2, MAX_BACKOFF_MS);
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        void connect();
      }, delay);
    };

    const connect = async () => {
      if (disposedRef.current) return;
      if (channelRef.current) {
        // Always tear down first: a stale channel keeps its own retry loop.
        const stale = channelRef.current;
        channelRef.current = null;
        await supabase.removeChannel(stale);
      }
      if (disposedRef.current) return;

      channelRef.current = supabase
        .channel(`vk-soc-feed-${Date.now()}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: INCIDENTS_TABLE },
          (payload) => {
            try {
              // Realtime decodes NUMERIC as a number while PostgREST may return
              // a string; normalizeIncident absorbs both.
              merge([normalizeIncident(payload.new as IncidentRow)]);
              setLastEventAt(Date.now());
            } catch (e) {
              console.error('[feed] baris realtime tidak dapat diurai', e);
            }
          },
        )
        .subscribe((s) => {
          if (disposedRef.current) return;
          if (s === 'SUBSCRIBED') {
            backoffRef.current = 1_000;
            setStatus('live');
            void catchUp(); // back-fill anything missed while not listening
          } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') {
            setStatus('reconnecting');
            scheduleReconnect();
          }
        });
    };

    // Paint history immediately; do not wait on the socket handshake.
    void catchUp();
    void connect();

    const onVisible = () => {
      if (document.visibilityState === 'visible') void catchUp();
    };
    const onOnline = () => {
      backoffRef.current = 1_000;
      void connect();
    };
    const onOffline = () => setStatus('offline');

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      disposedRef.current = true;
      if (retryTimer) clearTimeout(retryTimer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      const ch = channelRef.current;
      channelRef.current = null;
      if (ch) void supabase.removeChannel(ch);
    };
  }, [configured, catchUp, merge]);

  return { incidents, status, lastEventAt, error, refresh: () => void catchUp() };
}
