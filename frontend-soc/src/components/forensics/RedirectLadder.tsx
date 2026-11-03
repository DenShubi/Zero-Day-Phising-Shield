'use client';

/**
 * The redirect chain, with every hop enriched through the domain guard.
 *
 * /api/v1/domain/check never loads the page, so enriching each hop costs little
 * and turns a flat list of URLs into the most analytical panel on the page:
 * which hop introduced the shortener, where the lookalike appeared, which hop
 * dropped TLS. It reuses an endpoint that already exists — no backend work.
 */

import { useEffect, useRef, useState } from 'react';
import { checkDomain, type DomainAssessment } from '@/lib/api/endpoints';
import { defang, formatScore, truncateMiddle } from '@/lib/format';
import { bandOf, VERDICT_VAR } from '@/lib/verdict';

/** Flags worth calling out per hop, in the order a reader scans them. */
const HOP_FLAGS: { key: keyof DomainAssessment; label: string }[] = [
  { key: 'is_shortener', label: 'pemendek' },
  { key: 'is_free_or_tunnel_host', label: 'hosting gratis' },
  { key: 'is_high_abuse_tld', label: 'TLD rawan' },
  { key: 'is_punycode', label: 'punycode' },
  { key: 'is_ip', label: 'IP mentah' },
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
      // Sequential rather than parallel: the chain is short, and this keeps a
      // long redirect chain from opening a burst of connections at once.
      for (const hop of chain) {
        if (ac.signal.aborted) return;
        try {
          const assessment = await checkDomain(hop, ac.signal);
          if (!ac.signal.aborted) {
            setHops((prev) => ({ ...prev, [hop]: assessment }));
          }
        } catch {
          // A hop that cannot be assessed is still worth showing as a hop.
        }
      }
    })();

    return () => ac.abort();
  }, [chain]);

  if (chain.length === 0) return null;

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <h2 className="text-sm font-semibold text-[var(--foreground)]">
        Rantai Pengalihan ({chain.length} lompatan)
      </h2>

      <ol className="mt-3 flex flex-col gap-2">
        {chain.map((hop, i) => {
          const a = hops[hop];
          const band = a ? bandOf(a.risk_score) : null;
          const flags = a ? HOP_FLAGS.filter(({ key }) => a[key] === true) : [];

          return (
            <li key={`${hop}-${i}`} className="grid grid-cols-[1.5rem_1fr] gap-2">
              <span
                aria-hidden="true"
                className="vk-mono mt-0.5 text-right text-xs text-[var(--muted)]"
              >
                {i + 1}.
              </span>
              <div className="min-w-0 rounded border border-[var(--border)] bg-[var(--surface-raised)] px-2.5 py-1.5">
                <p className="vk-mono break-all text-xs text-[var(--foreground)]">
                  {defanged ? defang(truncateMiddle(hop, 92)) : truncateMiddle(hop, 92)}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  {a ? (
                    <>
                      <span
                        className="vk-mono text-[0.7rem] font-semibold tabular-nums"
                        style={{ color: `var(${VERDICT_VAR[band!]})` }}
                      >
                        {formatScore(a.risk_score)}
                      </span>
                      {a.is_official && (
                        <span className="text-[0.7rem] text-[var(--verdict-safe)]">resmi</span>
                      )}
                      {a.lookalike_of && (
                        <span className="text-[0.7rem] text-[var(--verdict-critical)]">
                          menyerupai {a.lookalike_of}
                        </span>
                      )}
                      {flags.map(({ key, label }) => (
                        <span key={key} className="text-[0.7rem] text-[var(--muted-strong)]">
                          {label}
                        </span>
                      ))}
                    </>
                  ) : (
                    <span className="text-[0.7rem] text-[var(--muted)]">memeriksa…</span>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
