'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  getMockTargets,
  previewTriage,
  scanImage,
  scanUrl,
  type MockTarget,
} from '@/lib/api/endpoints';
import { ApiAbortError, ApiError } from '@/lib/api/client';
import { cacheScan, newScanId } from '@/lib/scan-store';
import { UNIT_OPTIONS } from '@/lib/units-geo';
import { id as t } from '@/lib/i18n/id';
import { formatBytes } from '@/lib/format';
import {
  ImageRejected,
  imageFromClipboard,
  imageFromDrop,
  prepareImage,
  type PreparedImage,
} from '@/lib/image-prep';
import { DomainPreview } from './DomainPreview';
import { ScanProgress } from './ScanProgress';

type Mode = 'URL' | 'IMAGE';

/** The safe control: a genuine .mil.id portal, to show the whitelist path. */
const SAFE_CONTROL = 'https://tniad.mil.id';
const WARMUP_FLAG = 'vk.warmedUp';

export function ScanConsole() {
  const router = useRouter();

  const [mode, setMode] = useState<Mode>('URL');
  const [url, setUrl] = useState('');
  const [image, setImage] = useState<PreparedImage | null>(null);
  const [caption, setCaption] = useState('');
  const [unit, setUnit] = useState<string>(UNIT_OPTIONS[0] ?? 'Mabesad');

  const [targets, setTargets] = useState<MockTarget[]>([]);
  const [scanning, setScanning] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  // Guards against a double submit landing two scans on one click.
  const submittingRef = useRef(false);
  const previewUrlRef = useRef<string | null>(null);

  /* ----------------------------- initial load ---------------------------- */

  useEffect(() => {
    const ac = new AbortController();

    void getMockTargets(ac.signal)
      .then((r) => !ac.signal.aborted && setTargets(r.targets))
      .catch(() => {
        /* presets are a convenience; the form works without them */
      });

    // Warm the Chromium pool once per session so the first judge-driven scan
    // takes the warm path. /health does NOT warm it — only a real scan does,
    // so this fires a cheap one against the safe control and discards it.
    let warmed = true;
    try {
      warmed = sessionStorage.getItem(WARMUP_FLAG) === '1';
    } catch {
      /* storage blocked: skip warmup rather than repeat it every mount */
    }
    if (!warmed) {
      try {
        sessionStorage.setItem(WARMUP_FLAG, '1');
      } catch {
        /* ignore */
      }
      void scanUrl(SAFE_CONTROL, { scanId: newScanId(), reporterUnit: 'Pemanasan Mesin' }, ac.signal)
        .catch(() => {
          /* best effort: a failed warmup must never surface as a user error */
        });
    }

    return () => ac.abort();
  }, []);

  /* ------------------------------- clipboard ----------------------------- */

  const acceptFile = useCallback(async (file: File) => {
    setError(null);
    try {
      const prepared = await prepareImage(file);
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = prepared.previewUrl;
      setImage(prepared);
      setMode('IMAGE');
      setNotice(
        prepared.downscaled
          ? `Gambar dikecilkan ke ${prepared.dimensions.width}×${prepared.dimensions.height} px sebelum diunggah.`
          : null,
      );
    } catch (e) {
      setImage(null);
      setError(e instanceof ImageRejected ? e.message : 'Gambar tidak dapat diproses.');
    }
  }, []);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = imageFromClipboard(e);
      if (file) {
        e.preventDefault();
        void acceptFile(file);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [acceptFile]);

  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    [],
  );

  /* --------------------------------- scan -------------------------------- */

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    submittingRef.current = false;
    setScanning(false);
  }, []);

  const submit = useCallback(async () => {
    if (submittingRef.current) return;

    const target = url.trim();
    if (mode === 'URL' && target === '') {
      setError('Masukkan tautan target terlebih dahulu.');
      return;
    }
    if (mode === 'IMAGE' && !image) {
      setError('Pilih atau tempel gambar terlebih dahulu.');
      return;
    }

    submittingRef.current = true;
    setError(null);
    setNotice(null);
    setScanning(true);
    setStartedAt(Date.now());

    const ac = new AbortController();
    abortRef.current = ac;
    const scanId = newScanId();

    try {
      // Pre-flight for URLs: the engine refuses private and loopback targets,
      // and finding that out now costs under a second instead of mid-scan.
      if (mode === 'URL') {
        try {
          const triage = await previewTriage(target, false, ac.signal);
          if (triage.allowed === false) {
            setError(`Target ditolak mesin: ${triage.refusal_reason ?? 'di luar cakupan pemindaian'}`);
            setScanning(false);
            submittingRef.current = false;
            return;
          }
        } catch {
          // Pre-flight is advisory; a failure here should not block the scan.
        }
      }

      const scan =
        mode === 'URL'
          ? await scanUrl(target, { scanId, reporterUnit: unit }, ac.signal)
          : await scanImage(
              image!.file,
              {
                scanId,
                reporterUnit: unit,
                caption: caption.trim() || undefined,
                // The uploaded image's pixel space IS the bbox coordinate space.
                measured: image!.dimensions,
              },
              ac.signal,
            );

      cacheScan(scan);
      router.push(`/forensics?id=${encodeURIComponent(scan.incidentId ?? scan.scanId)}`);
    } catch (e) {
      if (e instanceof ApiAbortError) {
        // Cancelled deliberately, or timed out.
        if (e.timedOut) setError('Pemindaian melebihi batas waktu. Coba lagi atau periksa mesin.');
      } else if (e instanceof ApiError) {
        setError(e.detail);
      } else {
        setError(e instanceof Error ? e.message : 'Pemindaian gagal.');
      }
      setScanning(false);
    } finally {
      submittingRef.current = false;
      abortRef.current = null;
    }
  }, [mode, url, image, caption, unit, router]);

  /* -------------------------------- render ------------------------------- */

  if (scanning) {
    return (
      <div className="flex flex-col gap-4">
        <ScanProgress kind={mode} startedAt={startedAt} onCancel={cancel} />
        <p className="text-xs text-[var(--muted)]">
          Hasil akan terbuka otomatis di halaman Forensik setelah selesai.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Judge presets: self-hosted simulation targets, safe to scan. */}
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="text-sm font-semibold text-[var(--foreground)]">{t.scan.judgeTest}</h2>
        <p className="mt-0.5 text-xs text-[var(--muted)]">{t.scan.judgeTestHint}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {targets.map((target) => (
            <button
              key={target.filename}
              type="button"
              onClick={() => {
                setMode('URL');
                setUrl(target.url);
                setError(null);
              }}
              className="rounded border border-[var(--verdict-critical)]/40 bg-[var(--verdict-critical)]/10 px-2.5 py-1.5 text-xs text-[var(--foreground)] hover:bg-[var(--verdict-critical)]/20"
            >
              {target.filename.replace(/\.html$/, '')}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setMode('URL');
              setUrl(SAFE_CONTROL);
              setError(null);
            }}
            className="rounded border border-[var(--verdict-safe)]/40 bg-[var(--verdict-safe)]/10 px-2.5 py-1.5 text-xs text-[var(--foreground)] hover:bg-[var(--verdict-safe)]/20"
          >
            {t.scan.safeControl}
          </button>
          {targets.length === 0 && (
            <span className="text-xs text-[var(--muted)]">
              Daftar target simulasi tidak tersedia — mesin mungkin sedang luring.
            </span>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        {/* Mode switch */}
        <div className="mb-4 flex gap-1" role="tablist" aria-label="Jenis target">
          {(['URL', 'IMAGE'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => {
                setMode(m);
                setError(null);
              }}
              className={[
                'rounded px-3 py-1.5 text-sm transition-colors',
                mode === m
                  ? 'bg-[var(--accent)]/20 text-[var(--accent-bright)]'
                  : 'text-[var(--muted-strong)] hover:bg-[var(--surface-raised)]',
              ].join(' ')}
            >
              {m === 'URL' ? t.scan.urlLabel : t.scan.imageLabel}
            </button>
          ))}
        </div>

        {mode === 'URL' ? (
          <div>
            <label htmlFor="vk-url" className="block text-xs text-[var(--muted-strong)]">
              {t.scan.urlLabel}
            </label>
            <input
              id="vk-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void submit()}
              spellCheck={false}
              autoComplete="off"
              placeholder={t.scan.urlPlaceholder}
              className="vk-mono mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
            />
            <DomainPreview url={url} />
          </div>
        ) : (
          <div>
            <label className="block text-xs text-[var(--muted-strong)]">{t.scan.imageLabel}</label>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const file = imageFromDrop(e.nativeEvent);
                if (file) void acceptFile(file);
              }}
              className="mt-1 rounded border border-dashed px-4 py-6 text-center transition-colors"
              style={{
                borderColor: dragging ? 'var(--accent-bright)' : 'var(--border)',
                background: dragging ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'transparent',
              }}
            >
              {image ? (
                <div className="flex flex-col items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
                  <img
                    src={image.previewUrl}
                    alt="Pratinjau unggahan"
                    className="max-h-48 rounded border border-[var(--border)]"
                  />
                  <p className="vk-mono text-xs text-[var(--muted)]">
                    {image.dimensions.width}×{image.dimensions.height} px ·{' '}
                    {formatBytes(image.file.size)}
                    {image.downscaled && ` (asli ${formatBytes(image.originalBytes)})`}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
                      previewUrlRef.current = null;
                      setImage(null);
                      setNotice(null);
                    }}
                    className="text-xs text-[var(--muted-strong)] underline"
                  >
                    Ganti gambar
                  </button>
                </div>
              ) : (
                <>
                  <p className="text-sm text-[var(--muted-strong)]">{t.scan.imageHint}</p>
                  <input
                    id="vk-file"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void acceptFile(file);
                    }}
                  />
                  <label
                    htmlFor="vk-file"
                    className="mt-2 inline-block cursor-pointer rounded border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted-strong)] hover:bg-[var(--surface-raised)]"
                  >
                    Pilih berkas
                  </label>
                </>
              )}
            </div>

            <label htmlFor="vk-caption" className="mt-3 block text-xs text-[var(--muted-strong)]">
              {t.scan.captionLabel}
            </label>
            <input
              id="vk-caption"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Teks pesan yang menyertai gambar"
              className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
            />
          </div>
        )}

        {/* A free-text unit would never match the coordinate table, so the
            picker is what makes a demo scan appear on the map. */}
        <label htmlFor="vk-unit" className="mt-4 block text-xs text-[var(--muted-strong)]">
          {t.scan.unitLabel}
        </label>
        <select
          id="vk-unit"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
        >
          {UNIT_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>

        {notice && <p className="mt-3 text-xs text-[var(--muted)]">{notice}</p>}
        {error && (
          <p className="mt-3 rounded border-l-2 border-l-[var(--verdict-critical)] bg-[var(--surface-raised)] px-3 py-2 text-xs text-[var(--verdict-critical)]">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={() => void submit()}
          className="mt-4 w-full rounded bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--accent-bright)]"
        >
          {t.scan.submit}
        </button>
      </section>
    </div>
  );
}
