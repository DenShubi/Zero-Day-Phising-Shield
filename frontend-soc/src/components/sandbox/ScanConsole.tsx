'use client';

/**
 * Halaman Pindai Tautan atau Gambar.
 * Fokus pada form input tanpa panel kosong atau jargon yang mengganggu.
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
  IconOctagonAlert,
  IconScan,
  IconShieldCheck,
  IconUpload,
} from '@/components/ui/icons';
import { DomainPreview } from './DomainPreview';
import { ScanProgress } from './ScanProgress';

type Tab = 'url' | 'image';

const SAFE_PRESET = {
  title: 'tniad.mil.id (Resmi)',
  url: 'https://tniad.mil.id',
} as const;

function decoyLabel(filename: string): string {
  return filename
    .replace(/\.html$/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ScanConsole({
  onScanComplete,
}: {
  onScanComplete?: (scan: NormalizedScan) => void;
}) {
  const router = useRouter();
  const fileInputId = useId();
  const urlInputId = useId();
  const unitInputId = useId();

  const [tab, setTab] = useState<Tab>('url');
  const [url, setUrl] = useState('');
  const [unit, setUnit] = useState('');
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
        /* Tetap berjalan meskipun contoh lokal belum dimuat */
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
      setTab('image');
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

  const navigateToResult = useCallback(
    (scan: NormalizedScan) => {
      cacheScan(scan);
      onScanComplete?.(scan);
      const id = scan.incidentId ?? scan.scanId;
      router.replace(buildPanelHref('forensik', { insiden: id }), { scroll: false });
    },
    [onScanComplete, router],
  );

  const runUrlScan = async (targetOverride?: string) => {
    const target = (targetOverride ?? url).trim();
    if (!target || scanning) return;
    if (targetOverride) setUrl(targetOverride);

    setError(null);
    setScanning(true);
    setScanRunKey((k) => k + 1);

    const ac = new AbortController();
    abortRef.current = ac;
    const scanId = newScanId();

    try {
      const result = await scanUrl(
        target,
        { scanId, reporterUnit: unit.trim() || undefined },
        ac.signal,
      );
      navigateToResult(result);
    } catch (e) {
      if (e instanceof ApiAbortError) {
        setError(t.scan.abortedError);
      } else if (e instanceof ApiError) {
        setError(e.detail);
      } else {
        setError(t.scan.genericError);
      }
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
    const scanId = newScanId();

    try {
      const result = await scanImage(
        image.file,
        {
          scanId,
          reporterUnit: unit.trim() || undefined,
          measured: image.dimensions,
        },
        ac.signal,
      );
      navigateToResult(result);
    } catch (e) {
      if (e instanceof ApiAbortError) {
        setError(t.scan.abortedError);
      } else if (e instanceof ApiError) {
        setError(e.detail);
      } else {
        setError(t.scan.genericError);
      }
    } finally {
      setScanning(false);
      abortRef.current = null;
    }
  };

  const cancel = () => abortRef.current?.abort();

  return (
    <div className="vk-scroll flex min-h-0 flex-1 flex-col items-center overflow-y-auto p-4 sm:p-6">
      <div className="flex w-full max-w-2xl flex-col gap-4">
        {/* Pilihan Mode: URL atau Gambar */}
        <div
          role="tablist"
          aria-label={t.scan.title}
          className="grid grid-cols-2 gap-2 rounded-[4px] border border-[var(--border)] bg-[var(--surface-0)] p-1"
        >
          {(['url', 'image'] as const).map((k) => {
            const active = tab === k;
            return (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={active}
                disabled={scanning}
                onClick={() => {
                  setTab(k);
                  setError(null);
                }}
                className={[
                  'vk-btn h-9 rounded-[3px] px-3 text-[0.8125rem]',
                  active
                    ? 'border border-[var(--accent-border)] bg-[var(--accent-tint)] font-semibold text-[var(--foreground)]'
                    : 'border border-transparent text-[var(--muted-strong)] hover:text-[var(--foreground)]',
                ].join(' ')}
              >
                {k === 'url' ? <IconScan size={15} /> : <IconUpload size={15} />}
                <span>{k === 'url' ? t.scan.tabUrl : t.scan.tabImage}</span>
              </button>
            );
          })}
        </div>

        {/* Kartu Form Pemindaian */}
        <div className="flex flex-col gap-4 rounded-[4px] border border-[var(--border)] bg-[var(--surface-0)] p-4 sm:p-5">
          {tab === 'url' ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void runUrlScan();
              }}
              className="flex flex-col gap-3.5"
            >
              <div>
                <label
                  htmlFor={urlInputId}
                  className="block text-[0.8125rem] font-medium text-[var(--foreground)]"
                >
                  {t.scan.urlLabel}
                </label>
                <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
                  <input
                    id={urlInputId}
                    type="text"
                    inputMode="url"
                    autoComplete="off"
                    spellCheck={false}
                    disabled={scanning}
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder={t.scan.urlPlaceholder}
                    className="vk-mono h-10 min-w-0 flex-1 rounded-[4px] border border-[var(--border-strong)] bg-[var(--surface-1)] px-3 text-[0.875rem] text-[var(--foreground)] placeholder:text-[var(--muted)]"
                  />
                  <button
                    type="submit"
                    disabled={!url.trim() || scanning}
                    className="vk-btn vk-btn-primary h-10 shrink-0 px-5 text-[0.875rem]"
                  >
                    <IconScan size={15} />
                    <span>{scanning ? t.scan.scanning : t.scan.submitUrl}</span>
                  </button>
                </div>
              </div>

              {/* Pratinjau Domain (Hanya muncul saat URL diketik) */}
              <DomainPreview url={url} />

              <div>
                <label
                  htmlFor={unitInputId}
                  className="block text-[0.78rem] text-[var(--muted-strong)]"
                >
                  {t.scan.unitLabel}
                </label>
                <input
                  id={unitInputId}
                  type="text"
                  disabled={scanning}
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  placeholder={t.scan.unitPlaceholder}
                  className="mt-1 h-9 w-full rounded-[4px] border border-[var(--border)] bg-[var(--surface-1)] px-3 text-[0.8125rem] text-[var(--foreground)] placeholder:text-[var(--muted)]"
                />
              </div>

              {/* Contoh Uji Cepat (1 Klik) */}
              <div className="border-t border-[var(--border-subtle)] pt-3">
                <div className="mb-2 text-[0.75rem] font-medium text-[var(--muted)]">
                  {t.scan.presetsHeader}:
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {decoys.map((d) => (
                    <button
                      key={d.url}
                      type="button"
                      disabled={scanning}
                      onClick={() => void runUrlScan(d.url)}
                      className="vk-btn vk-btn-secondary h-7 px-2.5 text-[0.75rem]"
                    >
                      <span className="text-[var(--verdict-critical)]" aria-hidden="true">
                        <IconOctagonAlert size={12} />
                      </span>
                      <span>{decoyLabel(d.filename)}</span>
                    </button>
                  ))}

                  <button
                    type="button"
                    disabled={scanning}
                    onClick={() => void runUrlScan(SAFE_PRESET.url)}
                    className="vk-btn vk-btn-secondary h-7 px-2.5 text-[0.75rem]"
                  >
                    <span className="text-[var(--verdict-safe)]" aria-hidden="true">
                      <IconShieldCheck size={12} />
                    </span>
                    <span>{SAFE_PRESET.title}</span>
                  </button>
                </div>
              </div>
            </form>
          ) : (
            <div className="flex flex-col gap-3.5">
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
                className="flex flex-col items-center justify-center rounded-[4px] border border-dashed p-6 text-center transition-colors"
                style={{
                  borderColor: dragging ? 'var(--accent-ink)' : 'var(--border-strong)',
                  background: dragging ? 'var(--accent-tint)' : 'var(--surface-1)',
                }}
              >
                <input
                  id={fileInputId}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={scanning}
                  className="visually-hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void acceptFile(file);
                  }}
                />

                {image ? (
                  <div className="flex w-full flex-col items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
                    <img
                      src={image.previewUrl}
                      alt={image.file.name}
                      className="max-h-52 rounded-[4px] border border-[var(--border)] object-contain"
                    />
                    <div className="vk-mono text-[0.78rem] text-[var(--muted-strong)]">
                      {image.file.name} ({image.dimensions.width}x{image.dimensions.height} px ·{' '}
                      {(image.file.size / 1024).toFixed(0)} KB)
                    </div>
                    <div className="flex gap-2">
                      <label
                        htmlFor={fileInputId}
                        className="vk-btn vk-btn-secondary h-8 px-3 text-[0.78rem]"
                      >
                        {t.scan.changeFile}
                      </label>
                      <button
                        type="button"
                        disabled={scanning}
                        onClick={() => {
                          if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
                          previewUrlRef.current = null;
                          setImage(null);
                        }}
                        className="vk-btn vk-btn-secondary h-8 px-3 text-[0.78rem]"
                      >
                        {t.scan.clearImage}
                      </button>
                    </div>
                  </div>
                ) : (
                  <label
                    htmlFor={fileInputId}
                    className="flex cursor-pointer flex-col items-center gap-2 py-4"
                  >
                    <span className="grid h-10 w-10 place-items-center rounded-[4px] border border-[var(--border-strong)] bg-[var(--surface-2)] text-[var(--accent-ink)]">
                      <IconUpload size={18} />
                    </span>
                    <span className="text-[0.875rem] font-medium text-[var(--foreground)]">
                      {t.scan.dropPrompt}
                    </span>
                    <span className="text-[0.75rem] text-[var(--muted)]">{t.scan.dropHint}</span>
                  </label>
                )}
              </div>

              <div>
                <label
                  htmlFor={unitInputId}
                  className="block text-[0.78rem] text-[var(--muted-strong)]"
                >
                  {t.scan.unitLabel}
                </label>
                <input
                  id={unitInputId}
                  type="text"
                  disabled={scanning}
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  placeholder={t.scan.unitPlaceholder}
                  className="mt-1 h-9 w-full rounded-[4px] border border-[var(--border)] bg-[var(--surface-1)] px-3 text-[0.8125rem] text-[var(--foreground)] placeholder:text-[var(--muted)]"
                />
              </div>

              <button
                type="button"
                disabled={!image || scanning}
                onClick={() => void runImageScan()}
                className="vk-btn vk-btn-primary h-10 w-full px-4 text-[0.875rem]"
              >
                <IconScan size={15} />
                <span>{scanning ? t.scan.scanning : t.scan.submitImage}</span>
              </button>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-[4px] border border-[var(--verdict-critical)]/45 bg-[var(--surface-2)] p-3 text-[0.8125rem] text-[var(--foreground)]"
            >
              <span className="mt-0.5 shrink-0 text-[var(--verdict-critical)]" aria-hidden="true">
                <IconOctagonAlert size={15} />
              </span>
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Progres Pemindaian (Hanya tampil saat memindai) */}
        <ScanProgress
          key={scanRunKey}
          kind={tab === 'url' ? 'URL' : 'IMAGE'}
          onCancel={cancel}
          active={scanning}
        />
      </div>
    </div>
  );
}
