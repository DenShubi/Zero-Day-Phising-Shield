'use client';

/**
 * HTTP redirect chain, enriched per hop through /api/v1/domain/check.
 */

import { useEffect, useRef, useState } from 'react';
import { checkDomain, type DomainAssessment } from '@/lib/api/endpoints';
import { defang, formatScore, truncateMiddle } from '@/lib/format';
import { id as t } from '@/lib/i18n/id';
import { bandOf, VERDICT_VAR } from '@/lib/verdict';
import { IconOctagonAlert, IconShieldCheck, VerdictIcon } from '@/components/ui/icons';

const HOP_FLAGS: { key: keyof DomainAssessment; label: string }[] = [
  { key: 'is_shortener', label: t.forensics.hopShortener },
  { key: 'is_free_or_tunnel_host', label: t.forensics.hopFreeHost },
  { key: 'is_high_abuse_tld', label: t.forensics.hopAbuseTld },
  { key: 'is_punycode', label: t.forensics.hopPunycode },
  { key: 'is_ip', label: t.forensics.hopRawIp },
];

export function RedirectLadder({
  chain,
  defanged,
}: {
  chain: readonly string[];
  defanged: boolean;
}) {
  const [hops, setHops] = useState<Record<string, DomainAssessment>>({});
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (chain.length === 0) return;
    const ac = new AbortController();
    abortRef.current = ac;

    void (async () => {
      for (const hop of chain) {
        if (ac.signal.aborted) return;
        try {
          const assessment = await checkDomain(hop, ac.signal);
          if (!ac.signal.aborted) {
            setHops((prev) => ({ ...prev, [hop]: assessment }));
          }
        } catch {
          // Unassessed hop still renders cleanly as a hop.
        }
      }
    })();

    return () => ac.abort();
  }, [chain]);

  if (chain.length === 0) return null;

  return (
    <div className="vk-bento min-w-0 p-4">
      <h3 className="text-[1.125rem] font-semibold tracking-[-0.01em] text-[var(--foreground)]">
        {t.forensics.redirectTitle} ({chain.length} {t.forensics.hopsSuffix})
      </h3>

      <ol className="mt-3 flex flex-col gap-2">
        {chain.map((hop, i) => {
          const a = hops[hop];
          const band = a ? bandOf(a.risk_score) : null;
          const flags = a ? HOP_FLAGS.filter(({ key }) => a[key] === true) : [];

          return (
            <li key={`${hop}-${i}`} className="grid grid-cols-[1.75rem_1fr] gap-2">
              <span
                aria-hidden="true"
                className="vk-mono vk-tabular mt-1.5 text-right text-[0.8125rem] text-[var(--muted)]"
              >
                {i + 1}.
              </span>
              <div className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
                <div className="vk-mono break-all text-[0.8125rem] text-[var(--foreground)]">
                  {defanged ? defang(truncateMiddle(hop, 92)) : truncateMiddle(hop, 92)}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.8125rem]">
                  {a && band ? (
                    <>
                      <span
                        className="vk-mono vk-tabular inline-flex items-center gap-1 font-semibold"
                        style={{ color: `var(${VERDICT_VAR[band]})` }}
                      >
                        <VerdictIcon verdict={band} size={13} />
                        <span>{formatScore(a.risk_score)}</span>
                      </span>
                      {a.is_official && (
                        <span className="inline-flex items-center gap-1 text-[var(--verdict-safe)]">
                          <IconShieldCheck size={12} />
                          <span>{t.forensics.hopOfficial}</span>
                        </span>
                      )}
                      {a.lookalike_of && (
                        <span className="inline-flex items-center gap-1 text-[var(--verdict-critical)]">
                          <IconOctagonAlert size={12} />
                          <span>
                            {t.forensics.hopLookalikePrefix} {a.lookalike_of}
                          </span>
                        </span>
                      )}
                      {flags.map(({ key, label }) => (
                        <span key={String(key)} className="text-[var(--muted-strong)]">
                          {label}
                        </span>
                      ))}
                    </>
                  ) : (
                    <span className="text-[var(--muted)]">{t.forensics.hopChecking}</span>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
