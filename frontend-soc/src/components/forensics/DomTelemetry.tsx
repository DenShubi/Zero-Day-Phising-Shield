'use client';

/**
 * DOM telemetry: structural evidence behind the DOM anomaly score.
 *
 * Rows cross-highlight with the bounding-box overlay — hovering a form or input
 * here outlines it on the screenshot, and vice versa.
 */

import { defang, truncateMiddle } from '@/lib/format';
import { id as t } from '@/lib/i18n/id';
import type { UrlScanExtras } from '@/lib/normalize';
import { IconOctagonAlert, IconShieldCheck } from '@/components/ui/icons';
import { boxIdForForm, boxIdForInput } from './boxes';

interface Props {
  url: UrlScanExtras;
  highlightedId: string | null;
  onHighlight: (id: string | null) => void;
  defanged: boolean;
}

function TelemetryChip({
  children,
  tone = 'muted',
}: {
  children: React.ReactNode;
  tone?: 'muted' | 'critical' | 'safe';
}) {
  const color =
    tone === 'critical'
      ? 'var(--verdict-critical)'
      : tone === 'safe'
        ? 'var(--verdict-safe)'
        : 'var(--muted-strong)';
  return (
    <span
      className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[0.8125rem] font-medium leading-none"
      style={{
        color,
        borderColor: `color-mix(in srgb, ${color} 40%, transparent)`,
        background: `color-mix(in srgb, ${color} 10%, transparent)`,
      }}
    >
      {tone === 'critical' && <IconOctagonAlert size={12} />}
      {tone === 'safe' && <IconShieldCheck size={12} />}
      <span>{children}</span>
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
      <div className="vk-bento min-w-0 p-4">
        <h3 className="text-[1.125rem] font-semibold tracking-[-0.01em] text-[var(--foreground)]">
          {t.forensics.domTelemetry}
        </h3>
        <div className="mt-2 text-[0.875rem] text-[var(--muted)]">{t.forensics.domEmpty}</div>
      </div>
    );
  }

  const sensitiveCount = url.inputs.filter((i) => i.isSensitiveCredential).length;

  return (
    <div className="vk-bento min-w-0 p-4">
      <h3 className="text-[1.125rem] font-semibold tracking-[-0.01em] text-[var(--foreground)]">
        {t.forensics.domTelemetry}
      </h3>

      {url.forms.length > 0 && (
        <div className="mt-3.5">
          <h4 className="mb-2 text-[0.8125rem] font-medium tracking-[0.02em] text-[var(--muted)]">
            {t.forensics.formsHeader} ({url.forms.length})
          </h4>
          <ul className="flex flex-col gap-1.5">
            {url.forms.map((form, i) => {
              const boxId = boxIdForForm(form.index ?? i);
              const active = highlightedId === boxId;
              const dest = form.resolvedAction ?? form.action ?? t.forensics.unknownAction;
              return (
                <li
                  key={boxId}
                  onMouseEnter={() => onHighlight(boxId)}
                  onMouseLeave={() => onHighlight(null)}
                  className="rounded-lg border px-3 py-2 transition-colors"
                  style={{
                    borderColor: active ? 'var(--layer-form)' : 'var(--border)',
                    background: active
                      ? 'color-mix(in srgb, var(--layer-form) 14%, transparent)'
                      : 'var(--surface-2)',
                  }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <TelemetryChip>{form.method ?? 'GET'}</TelemetryChip>
                    {form.isCrossOrigin ? (
                      <TelemetryChip tone="critical">{t.forensics.crossOriginBadge}</TelemetryChip>
                    ) : (
                      <TelemetryChip tone="safe">{t.forensics.sameOriginBadge}</TelemetryChip>
                    )}
                  </div>
                  {/* Rendered as text, never an anchor: attacker endpoint must not be clickable. */}
                  <div className="vk-mono mt-1.5 break-all text-[0.8125rem] text-[var(--muted-strong)]">
                    → {show(truncateMiddle(dest, 88))}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {url.inputs.length > 0 && (
        <div className="mt-4">
          <h4 className="mb-2 text-[0.8125rem] font-medium tracking-[0.02em] text-[var(--muted)]">
            {t.forensics.inputsHeader} ({sensitiveCount} {t.forensics.sensitiveCountSuffix}{' '}
            {url.inputs.length})
          </h4>
          <ul className="flex flex-col gap-1.5">
            {url.inputs.map((input, i) => {
              const boxId = boxIdForInput(i);
              const active = highlightedId === boxId;
              return (
                <li
                  key={boxId}
                  onMouseEnter={() => onHighlight(boxId)}
                  onMouseLeave={() => onHighlight(null)}
                  className="grid grid-cols-[auto_1fr_auto] items-center gap-2.5 rounded-lg border px-3 py-1.5 text-[0.8125rem] transition-colors"
                  style={{
                    borderColor: active ? 'var(--layer-input)' : 'var(--border-subtle)',
                    background: active
                      ? 'color-mix(in srgb, var(--layer-input) 14%, transparent)'
                      : 'var(--surface-2)',
                  }}
                >
                  <span className="vk-mono font-medium text-[var(--foreground)]">
                    {input.name ?? input.id ?? input.tag}
                  </span>
                  <span className="truncate text-[var(--muted)]">
                    {input.placeholder ?? input.type ?? ''}
                  </span>
                  {input.isSensitiveCredential ? (
                    <TelemetryChip tone="critical">{t.forensics.credentialBadge}</TelemetryChip>
                  ) : (
                    <TelemetryChip>{input.type ?? 'text'}</TelemetryChip>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {(url.externalDomains.length > 0 || url.militaryKeywords.length > 0) && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {url.externalDomains.length > 0 && (
            <div>
              <h4 className="mb-1.5 text-[0.8125rem] font-medium tracking-[0.02em] text-[var(--muted)]">
                {t.forensics.externalDomainsHeader} ({url.externalDomains.length})
              </h4>
              <ul className="flex flex-col gap-1">
                {url.externalDomains.map((domain) => (
                  <li
                    key={domain}
                    className="vk-mono break-all text-[0.8125rem] text-[var(--muted-strong)]"
                  >
                    {show(domain)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {url.militaryKeywords.length > 0 && (
            <div>
              <h4 className="mb-1.5 text-[0.8125rem] font-medium tracking-[0.02em] text-[var(--muted)]">
                {t.forensics.militaryKeywordsHeader} ({url.militaryKeywords.length})
              </h4>
              <div className="text-[0.8125rem] leading-relaxed text-[var(--muted-strong)]">
                {url.militaryKeywords.join(', ')}
              </div>
            </div>
          )}
        </div>
      )}

      <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1.5 border-t border-[var(--border-subtle)] pt-3 text-[0.8125rem]">
        {url.statusCode !== null && (
          <div className="flex gap-1.5">
            <dt className="text-[var(--muted)]">{t.forensics.httpStatusLabel}</dt>
            <dd className="vk-mono vk-tabular text-[var(--muted-strong)]">{url.statusCode}</dd>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <dt className="text-[var(--muted)]">{t.forensics.officialDomainLabel}</dt>
          <dd
            className="inline-flex items-center gap-1 font-medium"
            style={{
              color: url.isOfficialMilDomain ? 'var(--verdict-safe)' : 'var(--verdict-critical)',
            }}
          >
            {url.isOfficialMilDomain ? <IconShieldCheck size={13} /> : <IconOctagonAlert size={13} />}
            <span>{url.isOfficialMilDomain ? t.forensics.yes : t.forensics.no}</span>
          </dd>
        </div>
        <div className="flex items-center gap-1.5">
          <dt className="text-[var(--muted)]">{t.forensics.credentialHarvestLabel}</dt>
          <dd
            className="inline-flex items-center gap-1 font-medium"
            style={{
              color: url.hasCredentialHarvesting ? 'var(--verdict-critical)' : 'var(--verdict-safe)',
            }}
          >
            {url.hasCredentialHarvesting ? (
              <IconOctagonAlert size={13} />
            ) : (
              <IconShieldCheck size={13} />
            )}
            <span>
              {url.hasCredentialHarvesting ? t.forensics.detected : t.forensics.notDetected}
            </span>
          </dd>
        </div>
        {url.pageTitle && (
          <div className="flex min-w-0 items-baseline gap-1.5">
            <dt className="shrink-0 text-[var(--muted)]">{t.forensics.pageTitleLabel}</dt>
            <dd className="min-w-0 flex-1 truncate text-[var(--muted-strong)]">{url.pageTitle}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}
