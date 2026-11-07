'use client';

/**
 * Live domain telemetry as the operator types.
 */

import { useEffect, useRef, useState } from 'react';
import { checkDomain, type DomainAssessment } from '@/lib/api/endpoints';
import { bandOf, VERDICT_VAR } from '@/lib/verdict';
import { formatScore } from '@/lib/format';
import { id as t } from '@/lib/i18n/id';
import { IconShieldCheck, VerdictIcon } from '@/components/ui/icons';

const DEBOUNCE_MS = 350;
const MIN_LENGTH = 4;

const FLAG_KEYS: { key: keyof DomainAssessment; label: string }[] = [
  { key: 'is_official', label: t.domainFlags.is_official },
  { key: 'is_shortener', label: t.domainFlags.is_shortener },
  { key: 'is_free_or_tunnel_host', label: t.domainFlags.is_free_or_tunnel_host },
  { key: 'is_high_abuse_tld', label: t.domainFlags.is_high_abuse_tld },
  { key: 'is_punycode', label: t.domainFlags.is_punycode },
  { key: 'is_ip', label: t.domainFlags.is_ip },
];

export function DomainPreview({ url }: { url: string }) {
  const [resolved, setResolved] = useState<{
    target: string;
    assessment: DomainAssessment | null;
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const trimmed = url.trim();
  const eligible = trimmed.length >= MIN_LENGTH && /[.:]/.test(trimmed);

  useEffect(() => {
    if (!eligible) {
      abortRef.current?.abort();
      return;
    }

    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      void checkDomain(trimmed, ac.signal)
        .then((r) => {
          if (!ac.signal.aborted) {
            setResolved({ target: trimmed, assessment: r });
          }
        })
        .catch(() => {
          if (!ac.signal.aborted) {
            setResolved({ target: trimmed, assessment: null });
          }
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [trimmed, eligible]);

  if (!eligible) return null;

  const isCurrent = resolved?.target === trimmed;
  const result = isCurrent ? resolved.assessment : null;

  if (!result) {
    return !isCurrent ? (
      <div className="mt-2 text-[0.75rem] text-[var(--muted)]">{t.scan.checkingDomain}</div>
    ) : null;
  }

  const band = bandOf(result.risk_score);
  const bandColor = `var(${VERDICT_VAR[band]})`;
  const activeFlags = FLAG_KEYS.filter(({ key }) => result[key] === true);

  return (
    <div className="mt-3 rounded-[3px] border border-[var(--border)] bg-[var(--surface-0)] px-3.5 py-2.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.8125rem]">
        <span className="vk-mono font-semibold text-[var(--foreground)]">{result.host}</span>

        <span
          className="vk-mono vk-tabular inline-flex items-center gap-1.5 font-semibold"
          style={{ color: bandColor }}
        >
          <VerdictIcon verdict={band} size={13} />
          <span>
            {t.scan.telemetryPrefix} {formatScore(result.risk_score)}
          </span>
        </span>

        {result.is_official && (
          <span className="inline-flex items-center gap-1 font-medium text-[var(--verdict-safe)]">
            <IconShieldCheck size={13} />
            <span>{t.scan.officialWhitelist}</span>
          </span>
        )}

        {result.lookalike_of && (
          <span className="font-medium text-[var(--verdict-critical)]">
            {t.scan.lookalikePrefix}{' '}
            <span className="vk-mono">{result.lookalike_of}</span>
            {result.lookalike_kind && ` (${result.lookalike_kind})`}
          </span>
        )}
      </div>

      {(activeFlags.length > 0 || result.bait_tokens.length > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {activeFlags.map(({ key, label }) => (
            <span
              key={key}
              className="vk-mono rounded-[2px] border border-[var(--border-strong)] bg-[var(--surface-2)] px-2 py-0.5 text-[0.72rem] text-[var(--muted-strong)]"
            >
              {label}
            </span>
          ))}
          {result.bait_tokens.length > 0 && (
            <span className="text-[0.75rem] text-[var(--muted-strong)]">
              {t.scan.baitTokensPrefix} {result.bait_tokens.join(', ')}
            </span>
          )}
        </div>
      )}

      {result.reasons.length > 0 && (
        <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[0.75rem] text-[var(--muted)]">
          {result.reasons.slice(0, 3).map((reason) => (
            <li key={reason}>· {reason}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
