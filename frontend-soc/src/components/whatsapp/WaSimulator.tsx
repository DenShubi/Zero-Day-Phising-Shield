'use client';

/**
 * WhatsApp "Lapor Cepat" simulation.
 *
 * The transport is simulated; the content is not. The webhook itself cannot be
 * driven from a deployed frontend — it requires an HMAC signature or token, and
 * is_loopback_request rejects anything carrying X-Forwarded-For, which every
 * proxy and tunnel adds. So this page calls the same /api/v1/scan-* endpoints
 * the bot calls and renders the reply through the port of the bot's own
 * formatter in lib/wa-report.ts.
 *
 * Every score, finding and ticket in a reply bubble is therefore real. Only the
 * delivery is mocked, and the page says so.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiAbortError, ApiError } from '@/lib/api/client';
import { getMockTargets, previewTriage, scanImage, scanUrl, type MockTarget } from '@/lib/api/endpoints';
import { formatReport } from '@/lib/wa-report';
import { formatTimeWib } from '@/lib/format';
import { cacheScan, newScanId } from '@/lib/scan-store';
import {
  ImageRejected,
  imageFromClipboard,
  imageFromDrop,
  prepareImage,
  type PreparedImage,
} from '@/lib/image-prep';
import type { NormalizedScan } from '@/lib/normalize';
import { WaMarkup } from './WaMarkup';

type Role = 'soldier' | 'bot';

interface Message {
  id: string;
  role: Role;
  text?: string;
  imageUrl?: string;
  at: string;
  /** Set on a bot reply backed by a completed scan. */
  scan?: NormalizedScan;
  pending?: boolean;
}

/** Mirrors the bot's acknowledgement before the scan completes. */
const ACK = '⏳ _Laporan diterima. Sedang memindai di sandbox terisolasi…_';

const GREETING =
  '👋 *VisiKartika Shield — Lapor Cepat*\n' +
  '_Kanal pelaporan cepat prajurit (simulasi)_\n' +
  '━━━━━━━━━━━━━━━━━━━━━━\n' +
  'Kirim *tautan* mencurigakan, atau *poster/tangkapan layar* untuk dianalisis.';

/**
 * The safe control is a genuine external portal, so it can be a constant. The
 * phishing decoys cannot: the engine builds their URLs from PUBLIC_BACKEND_URL,
 * so hardcoding localhost would point a deployed page at the visitor's own
 * machine instead of the engine. They are fetched at runtime instead.
 */
const SAFE_CONTROL = { label: 'Portal resmi', url: 'https://tniad.mil.id' } as const;

/** Trim the decoy filename down to something readable on a button. */
function decoyLabel(filename: string): string {
  return filename.replace(/\.html$/, '').replace(/_/g, ' ');
}

let seq = 0;
const nextId = () => `m${(seq += 1)}`;

export function WaSimulator() {
  const [messages, setMessages] = useState<Message[]>([
    { id: nextId(), role: 'bot', text: GREETING, at: new Date().toISOString() },
  ]);
  const [input, setInput] = useState('');
  const [image, setImage] = useState<PreparedImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [triageLane, setTriageLane] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [decoys, setDecoys] = useState<MockTarget[]>([]);

  const endRef = useRef<HTMLDivElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  // Decoy URLs are built by the engine from PUBLIC_BACKEND_URL, so they must be
  // fetched rather than assumed — see the note on SAFE_CONTROL above.
  useEffect(() => {
    const ac = new AbortController();
    void getMockTargets(ac.signal)
      .then((r) => !ac.signal.aborted && setDecoys(r.targets))
      .catch(() => {
        /* the control link alone is enough to demo with */
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

  const addMessage = (m: Omit<Message, 'id' | 'at'>) => {
    const id = nextId();
    setMessages((prev) => [...prev, { ...m, id, at: new Date().toISOString() }]);
    return id;
  };

  const acceptFile = useCallback(async (file: File) => {
    try {
      const prepared = await prepareImage(file);
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = prepared.previewUrl;
      setImage(prepared);
    } catch (e) {
      addMessage({
        role: 'bot',
        text: `⚠️ ${e instanceof ImageRejected ? e.message : 'Gambar tidak dapat diproses.'}`,
      });
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

  const send = useCallback(async () => {
    if (busy) return;
    const text = input.trim();
    if (!text && !image) return;

    setBusy(true);
    setInput('');

    // The soldier's own message, as it would appear in the thread.
    addMessage({
      role: 'soldier',
      text: text || undefined,
      imageUrl: image?.previewUrl,
    });

    const ackId = addMessage({ role: 'bot', text: ACK, pending: true });

    const ac = new AbortController();
    abortRef.current = ac;
    const scanId = newScanId();
    const sending = image;
    setImage(null);
    previewUrlRef.current = null; // ownership moves to the rendered bubble

    try {
      // The bot classifies the lane before scanning; show the same.
      try {
        const triage = await previewTriage(text, Boolean(sending), ac.signal);
        setTriageLane(triage.triage);
        if (!sending && triage.allowed === false) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === ackId
                ? {
                    ...m,
                    pending: false,
                    text:
                      '🚫 *Target di luar cakupan pemindaian*\n' +
                      `_${triage.refusal_reason ?? 'Alamat privat/lokal ditolak demi keamanan.'}_`,
                  }
                : m,
            ),
          );
          return;
        }
      } catch {
        // Lane preview is cosmetic; never block the scan on it.
      }

      const scan = sending
        ? await scanImage(
            sending.file,
            { scanId, reporterUnit: 'WA Lapor Cepat (Simulasi)', reporterSource: 'WHATSAPP_BOT', caption: text || undefined, measured: sending.dimensions },
            ac.signal,
          )
        : await scanUrl(
            text,
            { scanId, reporterUnit: 'WA Lapor Cepat (Simulasi)', reporterSource: 'WHATSAPP_BOT' },
            ac.signal,
          );

      cacheScan(scan);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === ackId
            ? { ...m, pending: false, text: formatReport(scan), scan }
            : m,
        ),
      );
    } catch (e) {
      const detail =
        e instanceof ApiAbortError
          ? 'Pemindaian dibatalkan atau melebihi batas waktu.'
          : e instanceof ApiError
            ? e.detail
            : 'Pemindaian gagal.';
      setMessages((prev) =>
        prev.map((m) => (m.id === ackId ? { ...m, pending: false, text: `⚠️ ${detail}` } : m)),
      );
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }, [busy, input, image]);

  return (
    <div className="flex flex-col gap-3">
      {/* Stated plainly and permanently, not buried in a tooltip. */}
      <p className="rounded border-l-2 border-l-[var(--verdict-suspicious)] bg-[var(--surface-raised)] px-3 py-2 text-xs text-[var(--muted-strong)]">
        <strong>Simulasi antarmuka.</strong> Pengiriman WhatsApp ditiru, tetapi seluruh skor,
        temuan, dan nomor tiket pada balasan berasal dari pemindaian nyata melalui mesin yang sama
        dengan bot produksi.
      </p>

      <div className="overflow-hidden rounded-lg border border-[var(--border)]">
        <header className="flex items-center gap-3 bg-[#1f2c33] px-4 py-2.5">
          <span
            aria-hidden="true"
            className="grid h-9 w-9 place-items-center rounded-full bg-[var(--accent)] text-sm font-bold text-white"
          >
            VK
          </span>
          <span className="leading-tight">
            <span className="block text-sm font-medium text-white">VisiKartika Lapor Cepat</span>
            <span className="block text-xs text-[#8696a0]">
              {busy ? 'sedang mengetik…' : 'daring'}
              {triageLane && ` · jalur ${triageLane}`}
            </span>
          </span>
        </header>

        {/* WhatsApp's own chat background tone, for a recognisable screenshot. */}
        <div
          className="flex max-h-[32rem] min-h-[22rem] flex-col gap-2 overflow-y-auto bg-[#0b141a] p-4"
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
          style={dragging ? { outline: '2px dashed var(--accent-bright)', outlineOffset: '-6px' } : undefined}
        >
          {messages.map((m) => {
            const mine = m.role === 'soldier';
            return (
              <div
                key={m.id}
                className={`flex ${mine ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className="max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed"
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
                      alt="Lampiran laporan"
                      className="mb-1.5 max-h-56 rounded"
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
                      className="ml-2 inline-block h-2 w-2 animate-pulse rounded-full bg-[#8696a0]"
                    />
                  )}
                  <span className="mt-1 block text-right text-[0.65rem] text-[#8696a0]">
                    {formatTimeWib(m.at).replace(' WIB', '')}
                    {mine && ' ✓✓'}
                  </span>
                </div>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>

        <div className="flex flex-col gap-2 bg-[#1f2c33] px-3 py-2.5">
          {image && (
            <div className="flex items-center gap-2 rounded bg-[#2a3942] px-2 py-1.5">
              {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
              <img src={image.previewUrl} alt="Pratinjau" className="h-10 w-10 rounded object-cover" />
              <span className="flex-1 text-xs text-[#8696a0]">
                {image.dimensions.width}×{image.dimensions.height} px siap dikirim
              </span>
              <button
                type="button"
                onClick={() => {
                  if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
                  previewUrlRef.current = null;
                  setImage(null);
                }}
                className="text-xs text-[#8696a0] underline"
              >
                Hapus
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
              title="Lampirkan poster atau tangkapan layar"
              className="cursor-pointer rounded px-2 py-1.5 text-lg leading-none text-[#8696a0] hover:bg-[#2a3942]"
            >
              📎
            </label>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void send()}
              placeholder="Ketik tautan mencurigakan, atau tempel tangkapan layar…"
              spellCheck={false}
              className="flex-1 rounded-full bg-[#2a3942] px-4 py-2 text-sm text-[#e9edef] placeholder:text-[#8696a0]"
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={busy || (!input.trim() && !image)}
              className="rounded-full bg-[var(--accent)] px-3.5 py-2 text-sm text-white disabled:opacity-40"
            >
              {busy ? '…' : 'Kirim'}
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <span className="self-center text-xs text-[var(--muted)]">Contoh laporan:</span>
        {[
          ...decoys.map((d) => ({ label: decoyLabel(d.filename), url: d.url })),
          SAFE_CONTROL,
        ].map((q) => (
          <button
            key={q.url}
            type="button"
            disabled={busy}
            onClick={() => setInput(q.url)}
            className="rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted-strong)] hover:bg-[var(--surface-raised)] disabled:opacity-40"
          >
            {q.label}
          </button>
        ))}
      </div>
    </div>
  );
}
