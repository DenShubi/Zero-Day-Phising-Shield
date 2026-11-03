'use client';

/**
 * Renders WhatsApp's inline markup: *bold*, _italic_, ~strike~ and `mono`.
 *
 * Tokenised into React nodes rather than rewritten into an HTML string. The
 * text being rendered contains attacker-controlled material — page titles, OCR
 * output, decoded QR payloads — so there is deliberately no path here through
 * dangerouslySetInnerHTML.
 */

import { Fragment, type ReactNode } from 'react';

type Marker = '*' | '_' | '~' | '`';

const STYLE: Record<Marker, string> = {
  '*': 'font-semibold',
  _: 'italic',
  '~': 'line-through',
  '`': 'vk-mono rounded bg-black/25 px-1 py-0.5 text-[0.95em]',
};

/**
 * A marker must hug non-space text AND sit on a word boundary.
 *
 * The boundary half is essential, not cosmetic: a reported URL such as
 * `rekrutmen_bintara_phish.html` has underscores surrounded by word characters,
 * and without the boundary check they are consumed as italic delimiters —
 * silently rewriting the indicator the operator is looking at. WhatsApp itself
 * does not format mid-word markers either.
 *
 * `lastIndex` is handled by exec on a non-global regex, so this stays stateless.
 */
const TOKEN = /(^|[^\w\\])([*_~`])(?=\S)([\s\S]*?\S)\2(?![\w])/;

function parse(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let i = 0;

  while (rest.length > 0) {
    const match = TOKEN.exec(rest);
    if (!match || match.index === undefined) {
      out.push(rest);
      break;
    }

    // match[1] is the boundary character the pattern had to consume; it is
    // literal text and must be preserved.
    const lead = rest.slice(0, match.index) + match[1];
    if (lead.length > 0) out.push(lead);

    const marker = match[2] as Marker;
    const inner = match[3];
    out.push(
      <span key={`${key}-${i}`} className={STYLE[marker]}>
        {/* Monospace spans are literal: backticks do not nest in WhatsApp. */}
        {marker === '`' ? inner : parse(inner, `${key}-${i}`)}
      </span>,
    );

    rest = rest.slice(match.index + match[0].length);
    i += 1;
  }

  return out;
}

export function WaMarkup({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <>
      {lines.map((line, i) => (
        <Fragment key={i}>
          {parse(line, `l${i}`)}
          {i < lines.length - 1 && <br />}
        </Fragment>
      ))}
    </>
  );
}
