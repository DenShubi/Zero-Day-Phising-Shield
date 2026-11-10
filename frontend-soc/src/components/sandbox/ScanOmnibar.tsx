'use client';

/**
 * The scan composer, docked at the top of Beranda.
 *
 * Scanning used to own a whole tab of its own, which left both it and the
 * history half-empty. It is one action - paste a link or drop a poster - so it
 * now sits above the history it produces, and the result lands in the table
 * below without a tab change.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiAbortError, ApiError } from '@/lib/api/client';
import { getMockTargets, scanImage, scanUrl, type MockTarget } from '@/lib/api/endpoints';
import { id as t } from '@/lib/i18n/id';
import {
  ImageRejected,
  imageFromClipboard,
  imageFromDrop,
  prepareImage,
  type PreparedImage,
} from '@/lib/image-prep';
import type { NormalizedScan } from '@/lib/normalize';
import { buildPanelHref } from '@/lib/panel-route';
import { cacheScan, newScanId } from '@/lib/scan-store';
import {
  IconClose,
  IconOctagonAlert,
  IconScan,
  IconSearch,
  IconShieldCheck,
  IconUpload,
} from '@/components/ui/icons';
import { DomainPreview } from './DomainPreview';
import { ScanProgress } from './ScanProgress';

type Mode = 'url' | 'image';

const SAFE_PRESET = {
  title: 'tniad.mil.id',
  url: 'https://tniad.mil.id',
} as const;

function decoyLabel(filename: string): string {
  return filename
    .replace(/\.html$/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ScanOmnibar({
  onScanComplete,
}: {
  onScanComplete?: (scan: NormalizedScan) => void;
}) {
  const router = useRouter();
  const fileInputId = useId();
  const urlInputId = useId();

  const [mode, setMode] = useState<Mode>('url');
  const [url, setUrl] = useState('');
  const [image, setImage] = useState<PreparedImage | null>(null);
  const [dragging, setDragging] = useState(false);

  const [scanning, setScanning] = useState(false);
  const [scanRunKey, setScanRunKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [decoys, setDecoys] = useState<MockTarget[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    void getMockTargets(ac.signal)
      .then((r) => !ac.signal.aborted && setDecoys(r.targets))
      .catch(() => {
        /* Contoh lokal belum dimuat: form tetap berfungsi penuh. */
      });
    return () => ac.abort();
  }, []);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    [],
  );

  const acceptFile = useCallback(async (file: File) => {
    setError(null);
    try {
      const prepared = await prepareImage(file);
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = prepared.previewUrl;
      setImage(prepared);
      setMode('image');
    } catch (e) {
      setError(e instanceof ImageRejected ? e.message : t.scan.dropInvalid);
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

  const clearImage = useCallback(() => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setImage(null);
  }, []);

  const finish = useCallback(
    (scan: NormalizedScan) => {
      cacheScan(scan);
      onScanComplete?.(scan);
      const scanKey = scan.incidentId ?? scan.scanId;
      router.replace(buildPanelHref('forensik', { insiden: scanKey }), { scroll: false });
    },
    [onScanComplete, router],
  );

  const reportFailure = useCallback((e: unknown) => {
    if (e instanceof ApiAbortError) setError(t.scan.abortedError);
    else if (e instanceof ApiError) setError(e.detail);
    else setError(t.scan.genericError);
  }, []);

  const runUrlScan = async (targetOverride?: string) => {
    const target = (targetOverride ?? url).trim();
    if (!target || scanning) return;
    if (targetOverride) {
      setUrl(targetOverride);
      setMode('url');
    }

    setError(null);
    setScanning(true);
    setScanRunKey((k) => k + 1);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const result = await scanUrl(
        target,
        { scanId: newScanId() },
        ac.signal,
      );
      finish(result);
    } catch (e) {
      reportFailure(e);
    } finally {
      setScanning(false);
      abortRef.current = null;
    }
  };

  const runImageScan = async () => {
    if (!image || scanning) return;

    setError(null);
    setScanning(true);
    setScanRunKey((k) => k + 1);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const result = await scanImage(
        image.file,
        {
          scanId: newScanId(),
          measured: image.dimensions,
        },
        ac.signal,
      );
      finish(result);
    } catch (e) {
      reportFailure(e);
    } finally {
      setScanning(false);
      abortRef.current = null;
    }
  };

  const cancel = () => abortRef.current?.abort();

  return (
    <section
      aria-label={t.scan.title}
      className="shrink-0 border-b border-[var(--border)] bg-[var(--surface-1)] px-4 py-3.5 sm:px-5"
    >
      <div className="flex flex-col gap-2.5">
        {/* Baris utama: tempel tautan, atau pindah ke mode gambar. */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (mode === 'image') void runImageScan();
            else void runUrlScan();
          }}
          className="flex flex-col gap-2 sm:flex-row sm:items-center"
        >
          <div className="relative min-w-0 flex-1">
            <label htmlFor={urlInputId} className="visually-hidden">
              {t.scan.urlLabel}
            </label>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--muted)]"
            >
              <IconSearch size={15} />
            </span>
            <input
              id={urlInputId}
              type="text"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              disabled={scanning || mode === 'image'}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t.scan.urlPlaceholder}
              className="vk-input vk-mono h-10 pl-9 text-[0.84rem] disabled:opacity-50"
            />
          </div>

          <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto">
            <button
              type="button"
              disabled={scanning}
              aria-pressed={mode === 'image'}
              onClick={() => {
                setError(null);
                setMode((m) => (m === 'image' ? 'url' : 'image'));
              }}
              className="vk-btn vk-btn-secondary h-10 px-3 text-[0.8125rem]"
            >
              <IconUpload size={15} />
              <span>{t.scan.modeImage}</span>
            </button>

            <button
              type="submit"
              disabled={scanning || (mode === 'image' ? !image : !url.trim())}
              className="vk-btn vk-btn-primary h-10 flex-1 px-5 text-[0.8125rem] sm:flex-initial"
            >
              <IconScan size={15} />
              <span>
                {scanning
                  ? t.scan.scanning
                  : mode === 'image'
                    ? t.scan.submitImage
                    : t.scan.submitUrl}
              </span>
            </button>
          </div>
        </form>

        {/* Dropzone hanya muncul saat mode gambar aktif. */}
        {mode === 'image' && (
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
            className="vk-dropzone rounded-[var(--r-lg)] border border-dashed p-3 transition-colors"
            style={{
              borderColor: dragging ? 'var(--accent)' : 'var(--border-strong)',
              background: dragging ? 'var(--accent-tint)' : 'var(--surface-2)',
            }}
          >
            <input
              id={fileInputId}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={scanning}
              className="vk-sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void acceptFile(file);
              }}
            />

            {image ? (
              <div className="flex flex-wrap items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
                <img
                  src={image.previewUrl}
                  alt={image.file.name}
                  className="h-16 w-16 rounded-[var(--r-md)] border border-[var(--border)] object-cover"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[0.8125rem] font-medium text-[var(--foreground)]">
                    {image.file.name}
                  </div>
                  <div className="vk-mono vk-tabular text-[0.72rem] text-[var(--muted)]">
                    {image.dimensions.width}&times;{image.dimensions.height} &middot;{' '}
                    {(image.file.size / 1024).toFixed(0)} KB
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <label
                    htmlFor={fileInputId}
                    className="vk-btn vk-btn-secondary h-8 cursor-pointer px-3 text-[0.78rem]"
                  >
                    {t.scan.changeFile}
                  </label>
                  <button
                    type="button"
                    disabled={scanning}
                    onClick={clearImage}
                    aria-label={t.scan.clearImage}
                    className="vk-btn vk-btn-ghost h-8 w-8 p-0 text-[var(--muted)]"
                  >
                    <IconClose size={14} />
                  </button>
                </div>
              </div>
            ) : (
              <label
                htmlFor={fileInputId}
                className="flex cursor-pointer flex-wrap items-center justify-center gap-2 py-2 text-center"
              >
                <span className="text-[var(--accent)]" aria-hidden="true">
                  <IconUpload size={16} />
                </span>
                <span className="text-[0.8125rem] font-medium text-[var(--foreground)]">
                  {t.scan.dropPrompt}
                </span>
                <span className="text-[0.75rem] text-[var(--muted)]">{t.scan.dropHint}</span>
              </label>
            )}
          </div>
        )}

        {mode === 'url' && <DomainPreview url={url} />}

        {/* Contoh uji satu klik. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {decoys.slice(0, 4).map((d) => (
              <button
                key={d.url}
                type="button"
                disabled={scanning}
                onClick={() => void runUrlScan(d.url)}
                className="vk-chip"
              >
                <span className="text-[var(--verdict-critical)]" aria-hidden="true">
                  <IconOctagonAlert size={11} />
                </span>
                <span>{decoyLabel(d.filename)}</span>
              </button>
            ))}
            <button
              type="button"
              disabled={scanning}
              onClick={() => void runUrlScan(SAFE_PRESET.url)}
              className="vk-chip"
            >
              <span className="text-[var(--verdict-safe)]" aria-hidden="true">
                <IconShieldCheck size={11} />
              </span>
              <span>{SAFE_PRESET.title}</span>
            </button>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-[var(--r-md)] px-3 py-2 text-[0.8125rem] text-[var(--foreground)]"
            style={{
              background: 'color-mix(in srgb, var(--verdict-critical) 9%, transparent)',
            }}
          >
            <span className="mt-0.5 shrink-0 text-[var(--verdict-critical)]" aria-hidden="true">
              <IconOctagonAlert size={14} />
            </span>
            <span>{error}</span>
          </div>
        )}

        <ScanProgress
          key={scanRunKey}
          kind={mode === 'url' ? 'URL' : 'IMAGE'}
          onCancel={cancel}
          active={scanning}
        />
      </div>
    </section>
  );
}
