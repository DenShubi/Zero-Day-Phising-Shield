'use client';

/**
 * WhatsApp "Simulasi Lapor Cepat" — authentic mobile chat thread on the left,
 * paired with a live SOC Pipeline Execution Telemetry inspector on the right so
 * conference spectators see the exact cause-and-effect behind every message.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { ApiAbortError, ApiError } from '@/lib/api/client';
import {
  getMockTargets,
  previewTriage,
  scanImage,
  scanUrl,
  type MockTarget,
} from '@/lib/api/endpoints';
import { formatReport } from '@/lib/wa-report';
import { formatScore, formatTimeWib } from '@/lib/format';
import { id as t } from '@/lib/i18n/id';
import { buildPanelHref } from '@/lib/panel-route';
import { cacheScan, newScanId } from '@/lib/scan-store';
import {
  ImageRejected,
  imageFromClipboard,
  imageFromDrop,
  prepareImage,
  type PreparedImage,
} from '@/lib/image-prep';
import type { NormalizedScan } from '@/lib/normalize';
import { VerdictBadge } from '@/components/ui/VerdictBadge';
import {
  IconAlertTriangle,
  IconArrowRight,
  IconCheck,
  IconMitigation,
  IconPaperclip,
  IconPipeline,
  IconSend,
  VisiKartikaMark,
} from '@/components/ui/icons';
import { WaMarkup } from './WaMarkup';

type Role = 'soldier' | 'bot';
type PipelinePhase = 'idle' | 'triage' | 'sandbox' | 'fusion' | 'complete' | 'refused' | 'error';

interface Message {
  id: string;
  role: Role;
  text?: string;
  imageUrl?: string;
  at: string;
  scan?: NormalizedScan;
  pending?: boolean;
}

const SAFE_CONTROL = { label: t.whatsapp.safeControlLabel, url: 'https://tniad.mil.id' } as const;

function decoyLabel(filename: string): string {
  return filename.replace(/\.html$/, '').replace(/_/g, ' ');
}

function extractHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    return new URL(raw).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

let seq = 0;
const nextId = () => `m${(seq += 1)}`;

export function WaSimulator({
  onScanComplete,
}: {
  onScanComplete?: (scan: NormalizedScan) => void;
} = {}) {
  const router = useRouter();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [initIso] = useState(() => new Date().toISOString());
  const [messages, setMessages] = useState<Message[]>(() => [
    { id: nextId(), role: 'bot', text: t.whatsapp.greetingMessage, at: '' },
  ]);
  const [input, setInput] = useState('');
  const [image, setImage] = useState<PreparedImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [triageLane, setTriageLane] = useState<string | null>(null);
  const [pipelinePhase, setPipelinePhase] = useState<PipelinePhase>('idle');
  const [activeModality, setActiveModality] = useState<'URL' | 'IMAGE'>('URL');
  const [lastScan, setLastScan] = useState<NormalizedScan | null>(null);
  const [dragging, setDragging] = useState(false);
  const [decoys, setDecoys] = useState<MockTarget[]>([]);

  const endRef = useRef<HTMLDivElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  useEffect(() => {
    const ac = new AbortController();
    void getMockTargets(ac.signal)
      .then((r) => !ac.signal.aborted && setDecoys(r.targets))
      .catch(() => {
        /* Safe control preset remains usable offline */
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

  const addMessage = useCallback((m: Omit<Message, 'id' | 'at'>) => {
    const msgId = nextId();
    setMessages((prev) => [...prev, { ...m, id: msgId, at: new Date().toISOString() }]);
    return msgId;
  }, []);

  const acceptFile = useCallback(
    async (file: File) => {
      try {
        const prepared = await prepareImage(file);
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = prepared.previewUrl;
        setImage(prepared);
        setActiveModality('IMAGE');
      } catch (e) {
        addMessage({
          role: 'bot',
          text: `*${t.common.error}:* ${e instanceof ImageRejected ? e.message : t.whatsapp.imageError}`,
        });
      }
    },
    [addMessage],
  );

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

  const send = useCallback(async () => {
    if (busy) return;
    const text = input.trim();
    if (!text && !image) return;

    const modality: 'URL' | 'IMAGE' = image ? 'IMAGE' : 'URL';
    setActiveModality(modality);
    setPipelinePhase('triage');
    setBusy(true);
    setInput('');

    addMessage({
      role: 'soldier',
      text: text || undefined,
      imageUrl: image?.previewUrl,
    });

    const ackId = addMessage({ role: 'bot', text: t.whatsapp.ackMessage, pending: true });

    const ac = new AbortController();
    abortRef.current = ac;
    const scanId = newScanId();
    const sending = image;
    setImage(null);
    previewUrlRef.current = null;

    try {
      try {
        const triage = await previewTriage(text, Boolean(sending), ac.signal);
        setTriageLane(triage.triage);
        if (!sending && triage.allowed === false) {
          setPipelinePhase('refused');
          setMessages((prev) =>
            prev.map((m) =>
              m.id === ackId
                ? {
                    ...m,
                    pending: false,
                    text: `${t.whatsapp.refusalHeader}\n_${triage.refusal_reason ?? t.whatsapp.refusalFallback}_`,
                  }
                : m,
            ),
          );
          return;
        }
      } catch {
        // Advisory triage only.
      }

      setPipelinePhase('sandbox');

      const scan = sending
        ? await scanImage(
            sending.file,
            {
              scanId,
              reporterUnit: t.whatsapp.reporterUnitDefault,
              reporterSource: 'WHATSAPP_BOT',
              caption: text || undefined,
              measured: sending.dimensions,
            },
            ac.signal,
          )
        : await scanUrl(
            text,
            {
              scanId,
              reporterUnit: t.whatsapp.reporterUnitDefault,
              reporterSource: 'WHATSAPP_BOT',
            },
            ac.signal,
          );

      setPipelinePhase('fusion');
      cacheScan(scan);
      setLastScan(scan);
      onScanComplete?.(scan);

      setMessages((prev) =>
        prev.map((m) =>
          m.id === ackId ? { ...m, pending: false, text: formatReport(scan), scan } : m,
        ),
      );
      setPipelinePhase('complete');
    } catch (e) {
      setPipelinePhase('error');
      const detail =
        e instanceof ApiAbortError
          ? t.whatsapp.abortError
          : e instanceof ApiError
            ? e.detail
            : t.whatsapp.genericError;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === ackId ? { ...m, pending: false, text: `*${t.common.error}:* ${detail}` } : m,
        ),
      );
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }, [busy, input, image, addMessage, onScanComplete]);

  const openForensics = (scan: NormalizedScan) => {
    router.replace(
      buildPanelHref('forensik', { insiden: scan.incidentId ?? scan.scanId }),
      { scroll: false },
    );
  };

  const openMitigation = (scan: NormalizedScan) => {
    const host = extractHost(scan.finalUrl ?? scan.submittedUrl);
    router.replace(buildPanelHref('mitigasi', { host }), { scroll: false });
  };

  const stageState = (stageIndex: 1 | 2 | 3 | 4): 'done' | 'active' | 'idle' | 'warn' => {
    if (pipelinePhase === 'idle') return 'idle';
    if (pipelinePhase === 'refused') return stageIndex === 1 ? 'warn' : 'idle';
    if (pipelinePhase === 'error') return stageIndex <= 2 ? 'warn' : 'idle';
    if (pipelinePhase === 'triage') return stageIndex === 1 ? 'active' : 'idle';
    if (pipelinePhase === 'sandbox') {
      if (stageIndex === 1) return 'done';
      if (stageIndex === 2) return 'active';
      return 'idle';
    }
    if (pipelinePhase === 'fusion') {
      if (stageIndex <= 2) return 'done';
      if (stageIndex === 3) return 'active';
      return 'idle';
    }
    return 'done';
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Simulation Honesty Callout */}
      <div className="flex items-center gap-2.5 rounded-lg border border-[var(--border)] border-l-2 border-l-[var(--verdict-suspicious)] bg-[var(--surface-1)] px-3.5 py-2 text-[0.8125rem] text-[var(--muted-strong)]">
        <span className="text-[var(--verdict-suspicious)]">
          <IconAlertTriangle size={15} />
        </span>
        <span>{t.whatsapp.simulationBanner}</span>
      </div>

      {/* Two-Column Cause & Effect Bento */}
      <div className="grid min-h-0 flex-1 gap-3.5 lg:grid-cols-12">
        {/* LEFT COLUMN (6 cols): Authentic WhatsApp Thread */}
        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[#0b141a] lg:col-span-6">
          <div className="flex items-center gap-3 border-b border-white/10 bg-[#1f2c33] px-4 py-2.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/10 bg-[#111b21]">
              <VisiKartikaMark size={22} />
            </span>
            <div className="min-w-0 leading-tight">
              <div className="truncate text-[0.875rem] font-semibold text-[#e9edef]">
                {t.whatsapp.botTitle}
              </div>
              <div className="truncate text-[0.8125rem] text-[#9bb0ba]">
                {busy ? t.whatsapp.statusTyping : t.whatsapp.statusOnline}
                {triageLane && ` · ${t.whatsapp.lanePrefix} ${triageLane}`}
              </div>
            </div>
          </div>

          {/* Messages Viewport */}
          <div
            className="vk-scroll flex min-h-[18rem] flex-1 flex-col gap-2.5 overflow-y-auto p-4"
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
            style={
              dragging
                ? { outline: '2px dashed var(--accent-ink)', outlineOffset: '-6px' }
                : undefined
            }
          >
            {messages.map((m) => {
              const mine = m.role === 'soldier';
              const host = m.scan ? extractHost(m.scan.finalUrl ?? m.scan.submittedUrl) : null;
              return (
                <div
                  key={m.id}
                  className={`flex ${mine ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className="max-w-[88%] rounded-lg px-3 py-2 text-[0.875rem] leading-relaxed"
                    style={{
                      background: mine ? '#005c4b' : '#202c33',
                      color: '#e9edef',
                      borderTopRightRadius: mine ? 2 : undefined,
                      borderTopLeftRadius: mine ? undefined : 2,
                    }}
                  >
                    {m.imageUrl && (
                      /* eslint-disable-next-line @next/next/no-img-element -- local object URL */
                      <img
                        src={m.imageUrl}
                        alt={t.whatsapp.attachmentAlt}
                        className="mb-2 max-h-48 rounded-md"
                      />
                    )}
                    {m.text && (
                      <span className="whitespace-pre-wrap break-words">
                        <WaMarkup text={m.text} />
                      </span>
                    )}
                    {m.pending && (
                      <span
                        aria-hidden="true"
                        className="ml-2 inline-block h-2 w-2 animate-pulse rounded-full bg-[#9bb0ba]"
                      />
                    )}

                    {/* Seamless cross-panel actions directly inside completed bot scan bubble */}
                    {m.scan && (
                      <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-white/10 pt-2">
                        <button
                          type="button"
                          onClick={() => openForensics(m.scan!)}
                          className="vk-btn h-7 rounded-md border border-white/15 bg-[#111b21] px-2.5 text-[0.8125rem] text-[#e9edef] hover:border-[var(--accent-ink)]"
                        >
                          <span>{t.whatsapp.openInForensics}</span>
                          <IconArrowRight size={13} />
                        </button>
                        {host && m.scan.verdict !== 'SAFE' && (
                          <button
                            type="button"
                            onClick={() => openMitigation(m.scan!)}
                            className="vk-btn h-7 rounded-md border border-[var(--verdict-critical)]/45 bg-[#111b21] px-2.5 text-[0.8125rem] text-[var(--verdict-critical)]"
                          >
                            <IconMitigation size={13} />
                            <span>{t.whatsapp.sendHostMitigation}</span>
                          </button>
                        )}
                      </div>
                    )}

                    <span className="vk-mono vk-tabular mt-1 block text-right text-[0.75rem] text-[#9bb0ba]">
                      {mounted ? formatTimeWib(m.at || initIso).replace(' WIB', '') : '--:--:--'}
                      {mine ? ` · ${t.whatsapp.readReceipt}` : ''}
                    </span>
                  </div>
                </div>
              );
            })}
            <div ref={endRef} />
          </div>

          {/* Preset Quick Scenarios + Composer */}
          <div className="flex flex-col gap-2 border-t border-white/10 bg-[#1f2c33] px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[0.8125rem] text-[#9bb0ba]">{t.whatsapp.presetsLabel}</span>
              {[
                ...decoys.map((d) => ({ label: decoyLabel(d.filename), url: d.url })),
                SAFE_CONTROL,
              ].map((q) => (
                <button
                  key={q.url}
                  type="button"
                  disabled={busy}
                  onClick={() => setInput(q.url)}
                  className="rounded-md border border-white/15 bg-[#2a3942] px-2 py-0.5 text-[0.8125rem] text-[#e9edef] transition-colors hover:border-[var(--accent-ink)] disabled:opacity-40"
                >
                  {q.label}
                </button>
              ))}
            </div>

            {image && (
              <div className="flex items-center gap-2.5 rounded-md bg-[#2a3942] px-2.5 py-1.5">
                {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
                <img
                  src={image.previewUrl}
                  alt={t.whatsapp.previewAlt}
                  className="h-10 w-10 rounded object-cover"
                />
                <span className="vk-mono vk-tabular flex-1 text-[0.8125rem] text-[#e9edef]">
                  {image.dimensions.width}×{image.dimensions.height} {t.whatsapp.readyToSendSuffix}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
                    previewUrlRef.current = null;
                    setImage(null);
                  }}
                  className="text-[0.8125rem] text-[#9bb0ba] underline hover:text-white"
                >
                  {t.whatsapp.removeAttachment}
                </button>
              </div>
            )}

            <div className="flex items-center gap-2">
              <input
                id="vk-wa-file"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void acceptFile(f);
                }}
              />
              <label
                htmlFor="vk-wa-file"
                title={t.whatsapp.attachTitle}
                aria-label={t.whatsapp.attachTitle}
                className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-lg border border-white/10 bg-[#2a3942] text-[#e9edef] transition-colors hover:border-[var(--accent-ink)]"
              >
                <IconPaperclip size={17} />
              </label>

              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void send()}
                placeholder={t.whatsapp.inputPlaceholder}
                spellCheck={false}
                className="h-9 min-w-0 flex-1 rounded-lg border border-white/10 bg-[#2a3942] px-3 text-[0.875rem] text-[#e9edef] placeholder:text-[#9bb0ba]"
              />

              <button
                type="button"
                onClick={() => void send()}
                disabled={busy || (!input.trim() && !image)}
                className="vk-btn vk-btn-primary h-9 shrink-0 px-3.5 text-[0.875rem]"
              >
                <IconSend size={15} />
                <span>{busy ? t.whatsapp.sending : t.whatsapp.send}</span>
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN (6 cols): SOC Pipeline Cause-and-Effect Telemetry */}
        <div className="vk-bento vk-scroll flex min-h-0 min-w-0 flex-col justify-between gap-3.5 overflow-y-auto p-4 lg:col-span-6">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[var(--accent-ink)]">
                <IconPipeline size={18} />
              </span>
              <h3 className="text-[1.125rem] font-semibold tracking-[-0.01em] text-[var(--foreground)]">
                {t.whatsapp.pipelineTitle}
              </h3>
            </div>
            <div className="mt-1 text-[0.8125rem] leading-relaxed text-[var(--muted)]">
              {t.whatsapp.pipelineSubtitle}
            </div>

            <ol className="mt-3.5 flex flex-col gap-2.5">
              {[
                {
                  idx: 1 as const,
                  title: t.whatsapp.stage1Title,
                  desc:
                    pipelinePhase === 'idle' ? t.whatsapp.stage1Idle : t.whatsapp.stage1Active,
                },
                {
                  idx: 2 as const,
                  title: t.whatsapp.stage2Title,
                  desc:
                    pipelinePhase === 'idle'
                      ? t.whatsapp.stage2Idle
                      : activeModality === 'IMAGE'
                        ? t.whatsapp.stage2Image
                        : t.whatsapp.stage2Url,
                },
                {
                  idx: 3 as const,
                  title: t.whatsapp.stage3Title,
                  desc: t.whatsapp.stage3Idle,
                },
                {
                  idx: 4 as const,
                  title: t.whatsapp.stage4Title,
                  desc: !lastScan
                    ? t.whatsapp.stage4Idle
                    : lastScan.synced
                      ? t.whatsapp.stage4Synced
                      : t.whatsapp.stage4Local,
                },
              ].map((step) => {
                const status = stageState(step.idx);
                return (
                  <li
                    key={step.idx}
                    className="rounded-lg border px-3.5 py-2.5 transition-colors"
                    style={{
                      borderColor:
                        status === 'active'
                          ? 'var(--accent-border)'
                          : status === 'done'
                            ? 'color-mix(in srgb, var(--verdict-safe) 35%, transparent)'
                            : status === 'warn'
                              ? 'color-mix(in srgb, var(--verdict-suspicious) 40%, transparent)'
                              : 'var(--border)',
                      background:
                        status === 'active' ? 'var(--accent-tint)' : 'var(--surface-2)',
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-[0.8125rem] font-medium tracking-[0.02em] text-[var(--foreground)]">
                        {step.title}
                      </h4>
                      {status === 'done' && (
                        <span className="text-[var(--verdict-safe)]">
                          <IconCheck size={15} />
                        </span>
                      )}
                      {status === 'active' && (
                        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[var(--accent-ink)]" />
                      )}
                      {status === 'warn' && (
                        <span className="text-[var(--verdict-suspicious)]">
                          <IconAlertTriangle size={15} />
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-[0.8125rem] leading-snug text-[var(--muted-strong)]">
                      {step.desc}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>

          {/* Last Executed Scan Breakdown */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3.5">
            <h4 className="text-[0.8125rem] font-medium tracking-[0.02em] text-[var(--muted)]">
              {t.whatsapp.lastResultTitle}
            </h4>

            {!lastScan ? (
              <div className="mt-1.5 text-[0.8125rem] leading-relaxed text-[var(--muted-strong)]">
                {t.whatsapp.noScanYet}
              </div>
            ) : (
              <div className="mt-2 flex flex-col gap-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <VerdictBadge verdict={lastScan.verdict} size="md" />
                  <span className="vk-mono vk-tabular text-[1.125rem] font-bold text-[var(--foreground)]">
                    {formatScore(lastScan.scores.total)} / 100
                  </span>
                </div>

                {lastScan.ticket && (
                  <div className="vk-mono text-[0.8125rem] text-[var(--muted-strong)]">
                    {t.common.ticket}: {lastScan.ticket}
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => openForensics(lastScan)}
                    className="vk-btn vk-btn-primary h-8 px-3 text-[0.8125rem]"
                  >
                    <span>{t.whatsapp.openInForensics}</span>
                    <IconArrowRight size={14} />
                  </button>
                  {extractHost(lastScan.finalUrl ?? lastScan.submittedUrl) &&
                    lastScan.verdict !== 'SAFE' && (
                      <button
                        type="button"
                        onClick={() => openMitigation(lastScan)}
                        className="vk-btn vk-btn-secondary h-8 px-3 text-[0.8125rem]"
                      >
                        <IconMitigation size={14} />
                        <span>{t.whatsapp.sendHostMitigation}</span>
                      </button>
                    )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
