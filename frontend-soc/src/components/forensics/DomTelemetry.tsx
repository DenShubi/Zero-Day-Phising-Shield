'use client';

/**
 * DOM telemetry: the structural evidence behind the DOM anomaly score.
 *
 * Rows cross-highlight with the bounding-box overlay — hovering a form or input
 * here outlines it on the screenshot, and vice versa. The ids come from
 * boxes.ts so both sides agree without either knowing about the other.
 *
 * This is submission screenshot #3 (DOM telemetry and credential exfiltration).
 */

import { defang, truncateMiddle } from '@/lib/format';
import type { UrlScanExtras } from '@/lib/normalize';
import { boxIdForForm, boxIdForInput } from './boxes';

interface Props {
  url: UrlScanExtras;
  highlightedId: string | null;
  onHighlight: (id: string | null) => void;
  defanged: boolean;
}

function Chip({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'critical' | 'safe' }) {
  const color =
    tone === 'critical'
      ? 'var(--verdict-critical)'
      : tone === 'safe'
        ? 'var(--verdict-safe)'
        : 'var(--muted-strong)';
  return (
    <span
      className="inline-block rounded border px-1.5 py-0.5 text-[0.7rem] leading-none"
      style={{ color, borderColor: `color-mix(in srgb, ${color} 40%, transparent)` }}
    >
      {children}
    </span>
  );
}

export function DomTelemetry({ url, highlightedId, onHighlight, defanged }: Props) {
  const show = (value: string) => (defanged ? defang(value) : value);

  const hasRows =
    url.forms.length > 0 ||
    url.inputs.length > 0 ||
    url.redirectChain.length > 0 ||
    url.externalDomains.length > 0 ||
    url.militaryKeywords.length > 0;

  if (!hasRows) {
    return (
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="text-sm font-semibold text-[var(--foreground)]">
          Telemetri DOM &amp; Eksfiltrasi Formulir
        </h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Tidak ada elemen formulir, input kredensial, atau pengalihan yang tercatat.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <h2 className="text-sm font-semibold text-[var(--foreground)]">
        Telemetri DOM &amp; Eksfiltrasi Formulir
      </h2>

      {url.forms.length > 0 && (
        <div className="mt-3">
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            Formulir ({url.forms.length})
          </h3>
          <ul className="flex flex-col gap-1.5">
            {url.forms.map((form, i) => {
              const boxId = boxIdForForm(form.index ?? i);
              const active = highlightedId === boxId;
              const dest = form.resolvedAction ?? form.action ?? '(tidak diketahui)';
              return (
                <li
                  key={boxId}
                  onMouseEnter={() => onHighlight(boxId)}
                  onMouseLeave={() => onHighlight(null)}
                  className="rounded border px-2.5 py-2 transition-colors"
                  style={{
                    borderColor: active ? 'var(--layer-form)' : 'var(--border)',
                    background: active
                      ? 'color-mix(in srgb, var(--layer-form) 12%, transparent)'
                      : 'var(--surface-raised)',
                  }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip>{form.method ?? 'GET'}</Chip>
                    {form.isCrossOrigin ? (
                      <Chip tone="critical">LINTAS-ORIGIN</Chip>
                    ) : (
                      <Chip tone="safe">same-origin</Chip>
                    )}
                  </div>
                  {/* Rendered as text, never an anchor: this is an attacker
                      endpoint and must not be clickable from a SOC console. */}
                  <p className="vk-mono mt-1 break-all text-xs text-[var(--muted-strong)]">
                    → {show(truncateMiddle(dest, 88))}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {url.inputs.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            Input ({url.inputs.filter((i) => i.isSensitiveCredential).length} kredensial sensitif dari{' '}
            {url.inputs.length})
          </h3>
          <ul className="flex flex-col gap-1">
            {url.inputs.map((input, i) => {
              const boxId = boxIdForInput(i);
              const active = highlightedId === boxId;
              return (
                <li
                  key={boxId}
                  onMouseEnter={() => onHighlight(boxId)}
                  onMouseLeave={() => onHighlight(null)}
                  className="grid grid-cols-[auto_1fr_auto] items-center gap-2 rounded border px-2.5 py-1.5 text-xs transition-colors"
                  style={{
                    borderColor: active ? 'var(--layer-input)' : 'transparent',
                    background: active
                      ? 'color-mix(in srgb, var(--layer-input) 12%, transparent)'
                      : 'var(--surface-raised)',
                  }}
                >
                  <span className="vk-mono text-[var(--foreground)]">
                    {input.name ?? input.id ?? input.tag}
                  </span>
                  <span className="truncate text-[var(--muted)]">
                    {input.placeholder ?? input.type ?? ''}
                  </span>
                  {input.isSensitiveCredential ? (
                    <Chip tone="critical">KREDENSIAL</Chip>
                  ) : (
                    <Chip>{input.type ?? 'text'}</Chip>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {url.externalDomains.length > 0 && (
          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              Domain eksternal dihubungi ({url.externalDomains.length})
            </h3>
            <ul className="flex flex-col gap-0.5">
              {url.externalDomains.map((domain) => (
                <li key={domain} className="vk-mono break-all text-xs text-[var(--muted-strong)]">
                  {show(domain)}
                </li>
              ))}
            </ul>
          </div>
        )}

        {url.militaryKeywords.length > 0 && (
          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              Kata kunci militer ({url.militaryKeywords.length})
            </h3>
            <p className="text-xs leading-relaxed text-[var(--muted-strong)]">
              {url.militaryKeywords.join(', ')}
            </p>
          </div>
        )}
      </div>

      <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1 border-t border-[var(--border)] pt-3 text-xs">
        {url.statusCode !== null && (
          <div className="flex gap-1.5">
            <dt className="text-[var(--muted)]">Status HTTP:</dt>
            <dd className="vk-mono text-[var(--muted-strong)]">{url.statusCode}</dd>
          </div>
        )}
        <div className="flex gap-1.5">
          <dt className="text-[var(--muted)]">Domain resmi:</dt>
          <dd style={{ color: url.isOfficialMilDomain ? 'var(--verdict-safe)' : 'var(--verdict-critical)' }}>
            {url.isOfficialMilDomain ? 'ya' : 'tidak'}
          </dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-[var(--muted)]">Pencurian kredensial:</dt>
          <dd style={{ color: url.hasCredentialHarvesting ? 'var(--verdict-critical)' : 'var(--verdict-safe)' }}>
            {url.hasCredentialHarvesting ? 'terdeteksi' : 'tidak terdeteksi'}
          </dd>
        </div>
        {url.pageTitle && (
          <div className="flex min-w-0 gap-1.5">
            <dt className="shrink-0 text-[var(--muted)]">Judul:</dt>
            {/* Attacker-controlled text. React escapes it; never use dangerouslySetInnerHTML. */}
            <dd className="truncate text-[var(--muted-strong)]">{url.pageTitle}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}
