'use client';

/**
 * Pratinjau reputasi domain saat pengguna mengetik URL.
 * Hanya muncul ketika ada URL yang diketik (tidak menampilkan tabel kosong).
 */

import { useEffect, useRef, useState } from 'react';
import { checkDomain, type DomainAssessment } from '@/lib/api/endpoints';
import { bandOf, VERDICT_VAR } from '@/lib/verdict';
import { formatScore } from '@/lib/format';
import { id as t } from '@/lib/i18n/id';
import { IconShieldCheck, VerdictIcon } from '@/components/ui/icons';

const DEBOUNCE_MS = 300;
const MIN_LENGTH = 4;

const RISK_FLAGS: { key: keyof DomainAssessment; label: string }[] = [
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
  const isChecking = !isCurrent;

  if (isChecking) {
    return (
      <div className="vk-card-quiet px-3.5 py-2.5 text-[0.78rem] text-[var(--muted)]">
        {t.scan.checkingDomain}
      </div>
    );
  }

  if (!result) return null;

  const band = bandOf(result.risk_score);
  const bandColor = `var(${VERDICT_VAR[band]})`;
  const activeFlags = RISK_FLAGS.filter((f) => result[f.key] === true);

  return (
    <div className="vk-card-quiet p-3.5 text-[0.8125rem]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="vk-mono font-semibold text-[var(--foreground)]">{result.host}</span>
          {result.is_official && (
            <span className="vk-pill bg-[var(--surface-1)] px-2 py-0.5 text-[0.72rem] text-[var(--verdict-safe)]">
              <IconShieldCheck size={12} />
              <span>{t.scan.officialWhitelist}</span>
            </span>
          )}
        </div>

        <span
          className="vk-mono vk-tabular inline-flex items-center gap-1.5 font-semibold"
          style={{ color: bandColor }}
        >
          <VerdictIcon verdict={band} size={13} />
          <span>
            {t.scan.telemetryPrefix} {formatScore(result.risk_score)}
          </span>
        </span>
      </div>

      {(result.lookalike_of || activeFlags.length > 0 || result.reasons.length > 0) && (
        <div className="mt-2 flex flex-col gap-1.5 border-t border-[var(--border-subtle)] pt-2 text-[0.78rem]">
          {result.lookalike_of && (
            <div className="font-medium text-[var(--verdict-critical)]">
              {t.scan.lookalikePrefix}{' '}
              <span className="vk-mono font-semibold">{result.lookalike_of}</span>
            </div>
          )}

          {activeFlags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {activeFlags.map((flag) => (
                <span
                  key={String(flag.key)}
                  className="vk-pill bg-[var(--surface-1)] px-2 py-0.5 text-[0.72rem] font-medium text-[var(--verdict-critical)]"
                >
                  {flag.label}
                </span>
              ))}
            </div>
          )}

          {result.reasons.length > 0 && (
            <ul className="text-[var(--muted-strong)]">
              {result.reasons.slice(0, 2).map((reason) => (
                <li key={reason}>· {reason}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
