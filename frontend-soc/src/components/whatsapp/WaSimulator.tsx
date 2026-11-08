'use client';

/**
 * Halaman Simulasi Lapor via WhatsApp:
 * - Kiri (4 kolom): Contoh pesan uji 1-klik & lampiran gambar/poster
 * - Kanan (8 kolom): Ruang chat bot WhatsApp
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
import { formatTimeWib } from '@/lib/format';
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
import {
  IconArrowRight,
  IconMitigation,
  IconOctagonAlert,
  IconPaperclip,
  IconSend,
  IconShieldCheck,
  VisiKartikaMark,
} from '@/components/ui/icons';
import { WaMarkup } from './WaMarkup';

type Role = 'soldier' | 'bot';

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
  return filename
    .replace(/\.html$/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function extractHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    return new URL(raw).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

function sanitizeBotText(raw: string): string {
  return raw.replace(/\s*\u2014\s*/g, ': ');
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
        /* Tetap dapat digunakan */
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

  const send = useCallback(
    async (overrideText?: string) => {
      if (busy) return;
      const text = (overrideText ?? input).trim();
      if (!text && !image) return;

      const modality: 'URL' | 'IMAGE' = image && !overrideText ? 'IMAGE' : 'URL';
      setBusy(true);
      if (!overrideText) setInput('');

      addMessage({
        role: 'soldier',
        text: text || undefined,
        imageUrl: modality === 'IMAGE' ? image?.previewUrl : undefined,
      });

      const ackId = addMessage({ role: 'bot', text: t.whatsapp.ackMessage, pending: true });

      const ac = new AbortController();
      abortRef.current = ac;
      const scanId = newScanId();
      const sending = modality === 'IMAGE' ? image : null;
      if (sending) {
        setImage(null);
        previewUrlRef.current = null;
      }

      try {
        try {
          const triage = await previewTriage(text, Boolean(sending), ac.signal);
          if (!sending && triage.allowed === false) {
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
          // Lanjut ke pemindaian utama
        }

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

        cacheScan(scan);
        onScanComplete?.(scan);

        setMessages((prev) =>
          prev.map((m) =>
            m.id === ackId
              ? { ...m, pending: false, text: sanitizeBotText(formatReport(scan)), scan }
              : m,
          ),
        );
      } catch (e) {
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
    },
    [busy, input, image, addMessage, onScanComplete],
  );

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

  return (
    <div className="grid min-h-0 flex-1 divide-y divide-[var(--border)] lg:grid-cols-12 lg:divide-x lg:divide-y-0">
      {/* KIRI (4 Kolom): Contoh Pesan Uji & Lampiran Gambar */}
      <aside className="vk-scroll flex min-h-0 min-w-0 flex-col justify-between divide-y divide-[var(--border)] overflow-y-auto bg-[var(--surface-0)] lg:col-span-4">
        <div className="p-4">
          <h2 className="text-[0.875rem] font-semibold text-[var(--foreground)]">
            {t.whatsapp.presetsLabel}
          </h2>
          <p className="mt-1 text-[0.75rem] text-[var(--muted)]">
            Klik salah satu contoh di bawah untuk langsung mengirimnya ke ruang chat.
          </p>

          <div className="mt-3 flex flex-col gap-2">
            {decoys.map((d) => {
              const label = decoyLabel(d.filename);
              return (
                <div
                  key={d.url}
                  className="flex items-center justify-between gap-2 rounded-[4px] border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-[0.78rem] font-medium text-[var(--foreground)]">
                      <span className="text-[var(--verdict-critical)]" aria-hidden="true">
                        <IconOctagonAlert size={12} />
                      </span>
                      <span className="truncate">{label}</span>
                    </div>
                    <div className="vk-mono truncate text-[0.6875rem] text-[var(--muted)]">
                      {d.url}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void send(d.url)}
                    className="vk-btn vk-btn-primary h-7 shrink-0 px-2.5 text-[0.72rem]"
                  >
                    <IconSend size={11} />
                    <span>Kirim</span>
                  </button>
                </div>
              );
            })}

            <div className="flex items-center justify-between gap-2 rounded-[4px] border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[0.78rem] font-medium text-[var(--foreground)]">
                  <span className="text-[var(--verdict-safe)]" aria-hidden="true">
                    <IconShieldCheck size={12} />
                  </span>
                  <span className="truncate">{SAFE_CONTROL.label}</span>
                </div>
                <div className="vk-mono truncate text-[0.6875rem] text-[var(--muted)]">
                  {SAFE_CONTROL.url}
                </div>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void send(SAFE_CONTROL.url)}
                className="vk-btn vk-btn-primary h-7 shrink-0 px-2.5 text-[0.72rem]"
              >
                <IconSend size={11} />
                <span>Kirim</span>
              </button>
            </div>
          </div>
        </div>

        {/* Lampiran Gambar / Poster */}
        <div className="p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[0.8125rem] font-semibold text-[var(--foreground)]">
              Lampiran Gambar / Poster
            </span>
            <input
              id="vk-wa-file"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="visually-hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void acceptFile(f);
              }}
            />
            <label
              htmlFor="vk-wa-file"
              title={t.whatsapp.attachTitle}
              className="vk-btn vk-btn-secondary h-7 px-2.5 text-[0.75rem]"
            >
              <IconPaperclip size={12} />
              <span>Pilih Gambar</span>
            </label>
          </div>

          {image ? (
            <div className="mt-2.5 flex flex-col gap-2 rounded-[4px] border border-[var(--accent-border)] bg-[var(--surface-1)] p-3">
              <div className="flex items-center gap-2.5">
                {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
                <img
                  src={image.previewUrl}
                  alt={t.whatsapp.previewAlt}
                  className="h-12 w-14 rounded-[3px] border border-[var(--border)] object-cover"
                />
                <div className="min-w-0 flex-1">
                  <div className="vk-mono vk-tabular text-[0.75rem] font-semibold text-[var(--foreground)]">
                    {image.dimensions.width}x{image.dimensions.height} px
                  </div>
                  <div className="text-[0.72rem] text-[var(--muted)]">
                    {t.whatsapp.readyToSendSuffix}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void send()}
                  className="vk-btn vk-btn-primary h-8 flex-1 px-3 text-[0.75rem]"
                >
                  <IconSend size={12} />
                  <span>Kirim Gambar</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
                    previewUrlRef.current = null;
                    setImage(null);
                  }}
                  className="vk-btn vk-btn-secondary h-8 px-3 text-[0.75rem]"
                >
                  {t.whatsapp.removeAttachment}
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-1.5 text-[0.75rem] text-[var(--muted)]">
              Tarik gambar ke ruang pesan atau tekan Ctrl+V untuk memeriksa poster/QR.
            </p>
          )}
        </div>
      </aside>

      {/* KANAN (8 Kolom): Ruang Chat WhatsApp */}
      <div
        className="flex min-h-0 min-w-0 flex-col overflow-hidden lg:col-span-8"
        style={{ background: 'var(--wa-canvas)', color: 'var(--wa-ink)' }}
      >
        <div
          className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-2.5"
          style={{ background: 'var(--wa-header)', borderColor: 'var(--wa-border)' }}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className="grid h-8 w-8 shrink-0 place-items-center rounded-[4px] border text-[var(--foreground)]"
              style={{ borderColor: 'var(--wa-border)', background: 'var(--surface-1)' }}
            >
              <VisiKartikaMark size={16} />
            </span>
            <div className="min-w-0 leading-tight">
              <div className="truncate text-[0.875rem] font-semibold text-[var(--wa-ink)]">
                {t.whatsapp.botTitle}
              </div>
              <div className="truncate text-[0.72rem] text-[var(--wa-muted)]">
                {busy ? t.whatsapp.statusTyping : t.whatsapp.statusOnline}
              </div>
            </div>
          </div>
        </div>

        {/* Daftar Pesan */}
        <div
          className="vk-scroll flex min-h-[16rem] flex-1 flex-col gap-3 overflow-y-auto p-4"
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
                  className="max-w-[85%] rounded-[4px] border px-3.5 py-2.5 text-[0.8125rem] leading-relaxed"
                  style={{
                    background: mine ? 'var(--wa-bubble-out)' : 'var(--wa-bubble-in)',
                    borderColor: 'var(--wa-border)',
                    color: 'var(--wa-ink)',
                  }}
                >
                  {m.imageUrl && (
                    /* eslint-disable-next-line @next/next/no-img-element -- local object URL */
                    <img
                      src={m.imageUrl}
                      alt={t.whatsapp.attachmentAlt}
                      className="mb-2 max-h-48 rounded-[3px] border border-[var(--wa-border)]"
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
                      className="ml-2 inline-block h-2 w-2 animate-pulse rounded-full bg-[var(--accent-ink)]"
                    />
                  )}

                  {m.scan && (
                    <div
                      className="mt-2.5 flex flex-wrap gap-2 border-t pt-2.5"
                      style={{ borderColor: 'var(--wa-border)' }}
                    >
                      <button
                        type="button"
                        onClick={() => openForensics(m.scan!)}
                        className="vk-btn vk-btn-secondary h-7 px-2.5 text-[0.75rem]"
                      >
                        <span>{t.whatsapp.openInForensics}</span>
                        <IconArrowRight size={12} />
                      </button>
                      {host && m.scan.verdict !== 'SAFE' && (
                        <button
                          type="button"
                          onClick={() => openMitigation(m.scan!)}
                          className="vk-btn h-7 border border-[var(--verdict-critical)] bg-[var(--surface-1)] px-2.5 text-[0.75rem] text-[var(--verdict-critical)]"
                        >
                          <IconMitigation size={12} />
                          <span>{t.whatsapp.sendHostMitigation}</span>
                        </button>
                      )}
                    </div>
                  )}

                  <span className="vk-mono vk-tabular mt-1 block text-right text-[0.6875rem] text-[var(--wa-muted)]">
                    {mounted ? formatTimeWib(m.at || initIso).replace(' WIB', '') : '--:--:--'}
                    {mine ? ` · ${t.whatsapp.readReceipt}` : ''}
                  </span>
                </div>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>

        {/* Input Pesan */}
        <div
          className="flex shrink-0 items-center gap-2 border-t px-4 py-2.5"
          style={{ background: 'var(--wa-header)', borderColor: 'var(--wa-border)' }}
        >
          <label
            htmlFor="vk-wa-file"
            title={t.whatsapp.attachTitle}
            aria-label={t.whatsapp.attachTitle}
            className="vk-btn vk-btn-secondary h-9 w-9 shrink-0 p-0"
          >
            <IconPaperclip size={15} />
          </label>

          <label htmlFor="vk-wa-msg" className="visually-hidden">
            {t.whatsapp.inputPlaceholder}
          </label>
          <input
            id="vk-wa-msg"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void send()}
            placeholder={t.whatsapp.inputPlaceholder}
            spellCheck={false}
            className="h-9 min-w-0 flex-1 rounded-[4px] border border-[var(--border-strong)] bg-[var(--surface-1)] px-3 text-[0.8125rem] text-[var(--foreground)] placeholder:text-[var(--muted)]"
          />

          <button
            type="button"
            onClick={() => void send()}
            disabled={busy || (!input.trim() && !image)}
            className="vk-btn vk-btn-primary h-9 shrink-0 px-4 text-[0.8125rem]"
          >
            <IconSend size={14} />
            <span>{busy ? t.whatsapp.sending : t.whatsapp.send}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
