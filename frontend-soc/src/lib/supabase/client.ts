'use client';

/**
 * Supabase browser client, used only for the realtime incident feed.
 *
 * The ANON key is the right key here and is public by design: RLS already
 * grants anon SELECT on scan_incidents (supabase/migrations/20261102_*.sql),
 * and the dashboard is an unauthenticated public demo.
 *
 * Note the same migration also grants anon INSERT. That is wider than this
 * dashboard needs for reading, and it is what the "Sinkron Ulang" recovery
 * action depends on. Before tightening it, check which key the backend itself
 * uses: app/supabase_client.py resolves SUPABASE_SERVICE_ROLE_KEY through an
 * alias chain that includes SUPABASE_ANON_KEY, and the live .env sets the
 * ambiguous SUPABASE_KEY - so revoking anon INSERT could break the engine's
 * own writes.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const INCIDENTS_TABLE = 'scan_incidents';

let cached: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

/**
 * Throws when unconfigured rather than returning a half-working client, so the
 * feed can show an explicit "Supabase belum dikonfigurasi" state and fall back
 * to polling the engine's /api/v1/incidents instead.
 */
export function getSupabase(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      'Supabase belum dikonfigurasi: isi NEXT_PUBLIC_SUPABASE_URL dan NEXT_PUBLIC_SUPABASE_ANON_KEY.',
    );
  }

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: {
      // The feed is low-volume; throttling keeps a burst of seeded inserts
      // from flooding the render loop.
      params: { eventsPerSecond: 5 },
    },
  });
  return cached;
}
