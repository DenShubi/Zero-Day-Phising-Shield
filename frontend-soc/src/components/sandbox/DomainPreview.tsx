'use client';

/**
 * Live domain telemetry as the operator types.
 *
 * /api/v1/domain/check never opens the page, so it answers in well under a
 * second — which makes it usable per keystroke and gives instant feedback long
 * before a full scan would finish. It also surfaces the domain guard as a
 * capability in its own right rather than hiding it inside a composite score.
 */

import { useEffect, useRef, useState } from 'react';
import { checkDomain, type DomainAssessment } from '@/lib/api/endpoints';
import { bandOf, VERDICT_VAR } from '@/lib/verdict';
import { formatScore } from '@/lib/format';

const DEBOUNCE_MS = 400;
const MIN_LENGTH = 4;

/** Indonesian labels for the boolean flags the domain guard returns. */
const FLAG_LABELS: { key: keyof DomainAssessment; label: string }[] = [
  { key: 'is_official', label: 'Domain resmi' },
  { key: 'is_shortener', label: 'Pemendek tautan' },
  { key: 'is_free_or_tunnel_host', label: 'Hosting gratis/tunnel' },
  { key: 'is_high_abuse_tld', label: 'TLD rawan penyalahgunaan' },
  { key: 'is_punycode', label: 'Punycode' },
  { key: 'is_ip', label: 'Alamat IP langsung' },
];

export function DomainPreview({ url }: { url: string }) {
  const [result, setResult] = useState<DomainAssessment | null>(null);
  const [pending, setPending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const trimmed = url.trim();

    // Nothing worth asking about yet.
    if (trimmed.length < MIN_LENGTH || !/[.:]/.test(trimmed)) {
      abortRef.current?.abort();
      setResult(null);
      setPending(false);
      return;
    }

    setPending(true);
    const timer = setTimeout(() => {
      // Supersede the in-flight request rather than racing it.
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      void checkDomain(trimmed, ac.signal)
        .then((r) => {
          if (!ac.signal.aborted) {
            setResult(r);
            setPending(false);
          }
        })
        .catch(() => {
          if (!ac.signal.aborted) {
            // A malformed host mid-typing is expected, not an error worth showing.
            setResult(null);
            setPending(false);
          }
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [url]);

  if (!result) {
    return pending ? (
      <p className="mt-2 text-xs text-[var(--muted)]">Memeriksa domain…</p>
    ) : null;
  }

  const band = bandOf(result.risk_score);
  const activeFlags = FLAG_LABELS.filter(({ key }) => result[key] === true);

  return (
    <div className="mt-2 rounded border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="vk-mono text-xs text-[var(--foreground)]">{result.host}</span>
        <span
          className="vk-mono text-xs font-semibold tabular-nums"
          style={{ color: `var(${VERDICT_VAR[band]})` }}
        >
          telemetri {formatScore(result.risk_score)}
        </span>
        {result.is_official && (
          <span className="text-xs text-[var(--verdict-safe)]">✓ daftar putih resmi</span>
        )}
      </div>

      {result.lookalike_of && (
        <p className="mt-1 text-xs text-[var(--verdict-critical)]">
          Menyerupai <span className="vk-mono">{result.lookalike_of}</span>
          {result.lookalike_kind && ` (${result.lookalike_kind})`}
        </p>
      )}

      {activeFlags.length > 0 && (
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {activeFlags.map(({ key, label }) => (
            <li
              key={key}
              className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[0.7rem] text-[var(--muted-strong)]"
            >
              {label}
            </li>
          ))}
        </ul>
      )}

      {result.bait_tokens.length > 0 && (
        <p className="mt-1 text-[0.7rem] text-[var(--muted-strong)]">
          Kata umpan: {result.bait_tokens.join(', ')}
        </p>
      )}

      {result.reasons.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-0.5">
          {result.reasons.slice(0, 3).map((reason) => (
            <li key={reason} className="text-[0.7rem] leading-snug text-[var(--muted)]">
              • {reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
