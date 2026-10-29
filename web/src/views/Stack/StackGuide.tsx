// How stacks work, in three picture cards (the Stack review picked them: c-learn A). They open by
// themselves the first time you open a stack or the Stacks list in this browser, again from "How
// stacks work" or "How it works" at any time, and sit on the empty Stacks list as they are. The
// pictures are drawn here (the shapes of the approved wireframe), in the theme's colours.
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { readStored, writeStored } from '../../lib/stored';

export interface StackCard { pic: 'split' | 'side' | 'merge'; title: string; say: string }

export const STACK_CARDS: readonly StackCard[] = [
  { pic: 'split', title: 'One ticket, a few parts', say: 'The Foreman splits a big ticket into small parts that don’t touch each other’s files.' },
  { pic: 'side', title: 'Built side by side', say: 'Each part gets its own Foreman and its own copy of the code.' },
  { pic: 'merge', title: 'Merged in order, pushed with your yes', say: 'Parts join one at a time. Nothing leaves your computer until you say go.' },
];

/** The guide's name in the first-visit list the other pages' guides use (components/page/Page.tsx). */
export const STACK_GUIDE_ID = 'stack';
const SEEN_KEY = 'gc.guide.seen';

/** Whether the cards open by themselves on the first visit. Tests turn it off unless they ask. */
let firstVisit = true;
export function setStackGuideFirstVisit(on: boolean) { firstVisit = on; }

function seen(): boolean {
  try { const v = JSON.parse(readStored(SEEN_KEY) ?? '[]'); return Array.isArray(v) && v.includes(STACK_GUIDE_ID); } catch { return false; }
}
function markSeen() {
  try {
    const v = JSON.parse(readStored(SEEN_KEY) ?? '[]');
    const list = Array.isArray(v) ? v : [];
    if (!list.includes(STACK_GUIDE_ID)) writeStored(SEEN_KEY, JSON.stringify([...list, STACK_GUIDE_ID]));
  } catch { writeStored(SEEN_KEY, JSON.stringify([STACK_GUIDE_ID])); }
}

/** [open, setOpen]: open on the first visit; closing it remembers that you have seen it. */
export function useStackGuide(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => firstVisit && !seen());
  return [open, (next: boolean) => { if (!next) markSeen(); setOpen(next); }];
}

function Picture({ pic }: { pic: StackCard['pic'] }) {
  if (pic === 'split') {
    return (
      <svg viewBox="0 0 120 40" className="stack-pic" aria-hidden="true">
        <rect x="14" y="12" width="22" height="16" rx="3" className="pic-stroke" />
        <path d="M25 12v16" className="pic-stroke pic-dash" />
        <path d="M44 20h10m-4-4 4 4-4 4" className="pic-stroke pic-quiet" />
        {[62, 80, 98].map((x) => <rect key={x} x={x} y="13" width="14" height="14" rx="3" className="pic-stroke pic-fill" />)}
      </svg>
    );
  }
  if (pic === 'side') {
    return (
      <svg viewBox="0 0 120 40" className="stack-pic" aria-hidden="true">
        {[[8, 84], [20, 62], [32, 74]].map(([y, end]) => (
          <g key={y}>
            <path d={`M14 ${y}H${end}`} className="pic-stroke pic-line" />
            <path d={`M${end} ${y}H108`} className="pic-stroke pic-dash pic-quiet" />
            <circle cx={end} cy={y} r="3.5" className="pic-dot" />
          </g>
        ))}
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 120 40" className="stack-pic" aria-hidden="true">
      <path d="M10 8C40 8 44 20 64 20M10 20H64M10 32C40 32 44 20 64 20" className="pic-stroke pic-ok" />
      <g transform="translate(84 8)" className="pic-stroke"><Rocket /></g>
    </svg>
  );
}

/** The rocket of the Push step, at 24 × 24. */
function Rocket() {
  return (
    <>
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
      <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
    </>
  );
}

/** The three cards, as the guide shows them and as the empty Stacks list does. */
export function StackGuideCards() {
  return (
    <ol className="guide-cards stack-guide-cards">
      {STACK_CARDS.map((c, i) => (
        <li key={c.title} className="guide-card">
          <span className="stack-pic-box"><Picture pic={c.pic} /></span>
          <span className="guide-n">{i + 1} of {STACK_CARDS.length}</span>
          <b className="guide-title">{c.title}</b>
          <span className="muted">{c.say}</span>
        </li>
      ))}
    </ol>
  );
}

/** The cards over the page. Escape, Skip or the button closes them. */
export function StackGuide({ done, onClose }: { done: string; onClose: () => void }) {
  const button = useRef<HTMLButtonElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    button.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close.current(); } };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); if (before?.isConnected) before.focus(); };
  }, []);
  return (
    <div className="sheet-backdrop guide-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="guide" role="dialog" aria-modal="true" aria-label="New to stacks?">
        <header className="guide-head">
          <h3>New to stacks?</h3>
          <button type="button" className="btn btn-quiet" onClick={onClose} title="Close this. How it works opens it again.">Skip</button>
        </header>
        <StackGuideCards />
        <footer className="guide-foot">
          <span className="muted">You can open this again with How it works.</span>
          <button ref={button} type="button" className="btn btn-primary btn-lg" onClick={onClose}>{done} <Icon name="chevron-right" size={16} /></button>
        </footer>
      </section>
    </div>
  );
}
