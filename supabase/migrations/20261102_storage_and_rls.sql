-- ============================================================================
-- Migration 2: Unique Domain Constraint, RLS Policies & Storage Bucket
-- Melengkapi 20261101_initial_schema.sql agar aman & siap untuk Realtime SOC
-- ============================================================================

-- 1. Pastikan official_domain unik agar proses seed/upsert tidak duplikat
CREATE UNIQUE INDEX IF NOT EXISTS idx_official_portals_domain
    ON public.official_portals (official_domain);

-- 2. Aktifkan Row Level Security (RLS) pada tabel public
ALTER TABLE public.official_portals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scan_incidents ENABLE ROW LEVEL SECURITY;

-- 3. Izinkan SELECT, INSERT, dan UPDATE pada official_portals & scan_incidents
--    agar Backend Engine dan Dashboard SOC dapat beroperasi dengan anon/service key
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'official_portals'
          AND policyname = 'Allow public read official_portals'
    ) THEN
        CREATE POLICY "Allow public read official_portals"
            ON public.official_portals FOR SELECT
            TO anon, authenticated
            USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'official_portals'
          AND policyname = 'Allow backend insert official_portals'
    ) THEN
        CREATE POLICY "Allow backend insert official_portals"
            ON public.official_portals FOR INSERT
            TO anon, authenticated
            WITH CHECK (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'official_portals'
          AND policyname = 'Allow backend update official_portals'
    ) THEN
        CREATE POLICY "Allow backend update official_portals"
            ON public.official_portals FOR UPDATE
            TO anon, authenticated
            USING (true)
            With CHECK (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'scan_incidents'
          AND policyname = 'Allow public read scan_incidents'
    ) THEN
        CREATE POLICY "Allow public read scan_incidents"
            ON public.scan_incidents FOR SELECT
            TO anon, authenticated
            USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'scan_incidents'
          AND policyname = 'Allow backend insert scan_incidents'
    ) THEN
        CREATE POLICY "Allow backend insert scan_incidents"
            ON public.scan_incidents FOR INSERT
            TO anon, authenticated
            WITH CHECK (true);
    END IF;
END
$$;

-- 4. Buat Public Storage Bucket 'scan-evidence' & izinkan SELECT / INSERT / UPDATE
INSERT INTO storage.buckets (id, name, public)
VALUES ('scan-evidence', 'scan-evidence', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
          AND policyname = 'Public read scan-evidence'
    ) THEN
        CREATE POLICY "Public read scan-evidence"
            ON storage.objects FOR SELECT
            TO anon, authenticated
            USING (bucket_id = 'scan-evidence');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
          AND policyname = 'Public insert scan-evidence'
    ) THEN
        CREATE POLICY "Public insert scan-evidence"
            ON storage.objects FOR INSERT
            TO anon, authenticated
            WITH CHECK (bucket_id = 'scan-evidence');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
          AND policyname = 'Public update scan-evidence'
    ) THEN
        CREATE POLICY "Public update scan-evidence"
            ON storage.objects FOR UPDATE
            TO anon, authenticated
            USING (bucket_id = 'scan-evidence')
            WITH CHECK (bucket_id = 'scan-evidence');
    END IF;
END
$$;
