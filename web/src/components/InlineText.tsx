// Short text from the Foreman shown clean: **bold**, `code`, *emphasis* and https links come out as
// formatting instead of raw marks. Built from React elements only (lib/inlineMarkdown.ts splits
// the text), so nothing is inserted as HTML; links open in a new tab without a referrer.
//
// InlineText: one line (a headline, a question, a reason); a leading "## " or "- " is dropped.
// ShortMarkdown: a few lines (the live row's latest text): headings, bullets and quotes as lines.
import type { ReactNode } from 'react';
import { parseInline, readLine, withoutBlockMark, type InlinePiece } from '../lib/inlineMarkdown';

function pieces(list: InlinePiece[], key = ''): ReactNode[] {
  return list.map((p, i) => {
    const k = `${key}${i}`;
    switch (p.kind) {
      case 'text': return p.text;
      case 'code': return <code key={k} className="inline-code">{p.text}</code>;
      case 'strong': return <strong key={k}>{pieces(p.children, `${k}.`)}</strong>;
      case 'em': return <em key={k}>{pieces(p.children, `${k}.`)}</em>;
      case 'link': return <a key={k} href={p.href} target="_blank" rel="noopener noreferrer">{pieces(p.children, `${k}.`)}</a>;
      default: return null;
    }
  });
}

export function InlineText({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  return <>{pieces(parseInline(withoutBlockMark(text)))}</>;
}

export function ShortMarkdown({ text }: { text: string }) {
  const lines = String(text ?? '').split(/\r?\n/).filter((l) => !/^\s*```/.test(l));
  return (
    <>
      {lines.map((raw, i) => {
        const l = readLine(raw);
        if (l.kind === 'rule' || (l.kind === 'text' && !l.text.trim())) return null;
        const body = pieces(parseInline(l.text), `${i}:`);
        if (l.kind === 'heading') return <span key={i} className="short-line short-heading"><strong>{body}</strong></span>;
        if (l.kind === 'bullet') return <span key={i} className="short-line short-bullet"><span aria-hidden="true">• </span>{body}</span>;
        if (l.kind === 'numbered') return <span key={i} className="short-line short-bullet">{l.marker}. {body}</span>;
        if (l.kind === 'quote') return <span key={i} className="short-line short-quote">{body}</span>;
        return <span key={i} className="short-line">{body}</span>;
      })}
    </>
  );
}
