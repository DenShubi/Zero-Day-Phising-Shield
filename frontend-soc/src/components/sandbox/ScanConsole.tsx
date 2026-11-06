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
import type { NormalizedScan } from '@/lib/normalize';
import { buildPanelHref } from '@/lib/panel-route';
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
import {
  IconOctagonAlert,
  IconScan,
  IconShieldCheck,
  IconUpload,
} from '@/components/ui/icons';
import { DomainPreview } from './DomainPreview';
import { ScanProgress } from './ScanProgress';

type Mode = 'URL' | 'IMAGE';

/** The safe control: a genuine .mil.id portal, to demonstrate the whitelist path. */
const SAFE_CONTROL = 'https://tniad.mil.id';
const WARMUP_FLAG = 'vk.warmedUp';

export function ScanConsole({
  onScanComplete,
}: {
  onScanComplete?: (scan: NormalizedScan) => void;
} = {}) {
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
  const submittingRef = useRef(false);
  const previewUrlRef = useRef<string | null>(null);

  /* ----------------------------- initial load ---------------------------- */

  useEffect(() => {
    const ac = new AbortController();

    void getMockTargets(ac.signal)
      .then((r) => !ac.signal.aborted && setTargets(r.targets))
      .catch(() => {
        /* presets are optional convenience chips */
      });

    let warmed = true;
    try {
      warmed = sessionStorage.getItem(WARMUP_FLAG) === '1';
    } catch {
      /* ignore */
    }
    if (!warmed) {
      try {
        sessionStorage.setItem(WARMUP_FLAG, '1');
      } catch {
        /* ignore */
      }
      void scanUrl(
        SAFE_CONTROL,
        { scanId: newScanId(), reporterUnit: t.scan.warmup },
        ac.signal,
      ).catch(() => {
        /* best effort warmup */
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
          ? `${t.scan.downscaledNoticePrefix} ${prepared.dimensions.width}×${prepared.dimensions.height} ${t.scan.downscaledNoticeSuffix}`
          : null,
      );
    } catch (e) {
      setImage(null);
      setError(e instanceof ImageRejected ? e.message : t.scan.imageProcessError);
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

  const runScan = useCallback(
    async (explicitMode?: Mode) => {
      if (submittingRef.current) return;
      const activeMode = explicitMode ?? (image && mode === 'IMAGE' ? 'IMAGE' : 'URL');

      const target = url.trim();
      if (activeMode === 'URL' && target === '') {
        setError(t.scan.emptyUrlError);
        return;
      }
      if (activeMode === 'IMAGE' && !image) {
        setError(t.scan.emptyImageError);
        return;
      }

      submittingRef.current = true;
      setMode(activeMode);
      setError(null);
      setNotice(null);
      setScanning(true);
      setStartedAt(Date.now());

      const ac = new AbortController();
      abortRef.current = ac;
      const scanId = newScanId();

      try {
        if (activeMode === 'URL') {
          try {
            const triage = await previewTriage(target, false, ac.signal);
            if (triage.allowed === false) {
              setError(
                `${t.scan.refusedPrefix} ${triage.refusal_reason ?? t.scan.refusedFallback}`,
              );
              setScanning(false);
              submittingRef.current = false;
              return;
            }
          } catch {
            // Advisory pre-flight only.
          }
        }

        const scan =
          activeMode === 'URL'
            ? await scanUrl(target, { scanId, reporterUnit: unit }, ac.signal)
            : await scanImage(
                image!.file,
                {
                  scanId,
                  reporterUnit: unit,
                  caption: caption.trim() || undefined,
                  measured: image!.dimensions,
                },
                ac.signal,
              );

        cacheScan(scan);
        onScanComplete?.(scan);
        const dest = buildPanelHref('forensik', { insiden: scan.incidentId ?? scan.scanId });
        router.replace(dest, { scroll: false });
      } catch (e) {
        if (e instanceof ApiAbortError) {
          if (e.timedOut) setError(t.scan.timeoutError);
        } else if (e instanceof ApiError) {
          setError(e.detail);
        } else {
          setError(e instanceof Error ? e.message : t.scan.genericScanError);
        }
        setScanning(false);
      } finally {
        submittingRef.current = false;
        abortRef.current = null;
      }
    },
    [image, mode, url, unit, caption, onScanComplete, router],
  );

  return (
    <div className="flex flex-col gap-3.5">
      {/* HERO: Dominant URL Input + Single Primary Action + Optional Judge Chips */}
      <div className="vk-bento min-w-0 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <label
            htmlFor="vk-url"
            className="text-[1.125rem] font-semibold tracking-[-0.01em] text-[var(--foreground)]"
          >
            {t.scan.urlLabel}
          </label>
          <span className="text-[0.8125rem] text-[var(--muted)]">{t.scan.urlPrimaryHint}</span>
        </div>

        <div className="mt-3 flex flex-col gap-2.5 sm:flex-row">
          <input
            id="vk-url"
            value={url}
            disabled={scanning}
            onChange={(e) => {
              setUrl(e.target.value);
              if (mode !== 'URL') setMode('URL');
              setError(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && void runScan('URL')}
            spellCheck={false}
            autoComplete="off"
            placeholder={t.scan.urlPlaceholder}
            className="vk-mono h-[54px] min-w-0 flex-1 rounded-lg border border-[var(--border-strong)] bg-[var(--canvas)] px-4 text-[1.125rem] tracking-[-0.01em] text-[var(--foreground)] placeholder:text-[var(--ink-disabled)]"
          />

          <button
            type="button"
            disabled={scanning}
            onClick={() => void runScan(image && mode === 'IMAGE' ? 'IMAGE' : 'URL')}
            className="vk-btn vk-btn-primary h-[54px] shrink-0 px-6 text-[0.9375rem] font-semibold"
          >
            <IconScan size={18} />
            <span>{image && mode === 'IMAGE' ? t.scan.submitImage : t.scan.submit}</span>
          </button>
        </div>

        <DomainPreview url={url} />

        {/* Optional Judge Presets Strip */}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-3.5">
          <span className="text-[0.8125rem] font-medium text-[var(--muted)]">
            {t.scan.judgeTest}:
          </span>

          {targets.map((target) => (
            <button
              key={target.filename}
              type="button"
              disabled={scanning}
              onClick={() => {
                setMode('URL');
                setUrl(target.url);
                setError(null);
              }}
              className="vk-btn h-7 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 text-[0.8125rem] text-[var(--foreground)] hover:border-[var(--verdict-critical)]"
            >
              <span className="text-[var(--verdict-critical)]">
                <IconOctagonAlert size={13} />
              </span>
              <span>{target.filename.replace(/\.html$/, '').replace(/_/g, ' ')}</span>
            </button>
          ))}

          <button
            type="button"
            disabled={scanning}
            onClick={() => {
              setMode('URL');
              setUrl(SAFE_CONTROL);
              setError(null);
            }}
            className="vk-btn h-7 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 text-[0.8125rem] text-[var(--foreground)] hover:border-[var(--verdict-safe)]"
          >
            <span className="text-[var(--verdict-safe)]">
              <IconShieldCheck size={13} />
            </span>
            <span>{t.scan.safeControl}</span>
          </button>

          {targets.length === 0 && (
            <span className="text-[0.8125rem] text-[var(--muted)]">{t.scan.judgeOffline}</span>
          )}
        </div>

        {notice && (
          <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[0.8125rem] text-[var(--muted-strong)]">
            {notice}
          </div>
        )}
        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-[var(--border)] border-l-2 border-l-[var(--verdict-critical)] bg-[var(--surface-2)] px-3.5 py-2.5 text-[0.875rem] text-[var(--foreground)]">
            <span className="mt-0.5 shrink-0 text-[var(--verdict-critical)]" aria-hidden="true">
              <IconOctagonAlert size={15} />
            </span>
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* SECONDARY ROW: Compact Image Dropzone Affordance + Reporter Unit */}
      <div className="grid gap-3.5 lg:grid-cols-[1.35fr_1fr]">
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
          className="vk-bento flex min-w-0 flex-col justify-between p-4 transition-colors"
          style={
            dragging
              ? {
                  borderColor: 'var(--accent-ink)',
                  background: 'var(--accent-tint)',
                }
              : undefined
          }
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-[1.125rem] font-semibold tracking-[-0.01em] text-[var(--foreground)]">
                {t.scan.imageLabel}
              </h3>
              <div className="text-[0.8125rem] text-[var(--muted)]">{t.scan.imageSubLabel}</div>
            </div>

            <input
              id="vk-file"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              disabled={scanning}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void acceptFile(file);
              }}
            />
            <label
              htmlFor="vk-file"
              className="vk-btn vk-btn-secondary h-9 px-3 text-[0.875rem]"
            >
              <IconUpload size={15} />
              <span>{t.scan.chooseFile}</span>
            </label>
          </div>

          {image ? (
            <div className="mt-3 flex flex-col gap-3 rounded-lg border border-[var(--accent-border)] bg-[var(--surface-2)] p-3 sm:flex-row sm:items-center">
              {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
              <img
                src={image.previewUrl}
                alt={t.scan.previewAlt}
                className="h-16 w-24 shrink-0 rounded-md border border-[var(--border)] object-cover"
              />
              <div className="min-w-0 flex-1">
                <div className="vk-mono vk-tabular text-[0.8125rem] font-medium text-[var(--foreground)]">
                  {image.dimensions.width}×{image.dimensions.height} px ·{' '}
                  {formatBytes(image.file.size)}
                  {image.downscaled &&
                    ` (${t.scan.originalPrefix} ${formatBytes(image.originalBytes)})`}
                </div>
                <input
                  id="vk-caption"
                  aria-label={t.scan.captionLabel}
                  value={caption}
                  disabled={scanning}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder={t.scan.captionPlaceholder}
                  className="mt-1.5 w-full rounded-md border border-[var(--border)] bg-[var(--canvas)] px-2.5 py-1.5 text-[0.8125rem] text-[var(--foreground)]"
                />
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  disabled={scanning}
                  onClick={() => void runScan('IMAGE')}
                  className="vk-btn vk-btn-primary h-9 px-3 text-[0.8125rem]"
                >
                  {t.scan.submitImage}
                </button>
                <button
                  type="button"
                  disabled={scanning}
                  onClick={() => {
                    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
                    previewUrlRef.current = null;
                    setImage(null);
                    setMode('URL');
                    setNotice(null);
                  }}
                  className="vk-btn vk-btn-secondary h-9 px-2.5 text-[0.8125rem]"
                >
                  {t.scan.replaceImage}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-3 rounded-lg border border-dashed border-[var(--border-strong)] bg-[var(--surface-2)]/50 px-4 py-3.5 text-[0.875rem] text-[var(--muted-strong)]">
              {t.scan.imageHint}
            </div>
          )}
        </div>

        <div className="vk-bento flex min-w-0 flex-col justify-between p-4">
          <div>
            <h3 className="text-[1.125rem] font-semibold tracking-[-0.01em] text-[var(--foreground)]">
              {t.scan.unitLabel}
            </h3>
            <div className="mt-0.5 text-[0.8125rem] text-[var(--muted)]">{t.scan.unitHint}</div>

            <select
              id="vk-unit"
              aria-label={t.scan.unitLabel}
              value={unit}
              disabled={scanning}
              onChange={(e) => setUnit(e.target.value)}
              className="mt-3 h-10 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--canvas)] px-3 text-[0.875rem] text-[var(--foreground)]"
            >
              {UNIT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-3 border-t border-[var(--border-subtle)] pt-2.5 text-[0.8125rem] leading-relaxed text-[var(--muted)]">
            {t.scan.judgeTestHint}
          </div>
        </div>
      </div>

      {/* HORIZONTAL STEPPER (5-meter legible in both standby and active scanning) */}
      <ScanProgress kind={mode} startedAt={startedAt} onCancel={cancel} active={scanning} />
    </div>
  );
}
