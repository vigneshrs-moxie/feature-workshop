// The pieces every page of the new look is built from (packet M):
//   <Page>       the page across the whole window (even --page-gutter sides), its heading row and body
//   <NextBar>    the one next step: what it is in a sentence, and one big button with its key
//   <Guide>      the three-card "How it works", shown by itself the first time a page opens
//   <Fold>       a folded section with its count ("Resting · 2 idle   Show ⌄")
//   <Hero>       an empty state: a picture, one sentence, one or two buttons
// Words carry the meaning everywhere; icons are decoration and colour never stands alone.
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Button } from '../Button';
import { Icon, type IconName } from '../Icon';
import { useStored } from '../../lib/stored';

export function Page({ label, title, head, children, className = '', guide }: {
  label: string;
  title: ReactNode;
  /** What sits on the heading row after the title: tabs, a sort note, Refresh. */
  head?: ReactNode;
  children: ReactNode;
  className?: string;
  /** The page's guide: its How it works button and the three cards. */
  guide?: GuideSpec;
}) {
  const [guideOpen, setGuideOpen] = useGuide(guide?.id ?? null);
  return (
    <main className={`page ${className}`.trim()} aria-label={label}>
      <div className="page-inner">
        <header className="page-head">
          <h2 className="page-title">{title}</h2>
          {head}
          {guide && (
            <Button kind="quiet" icon="help" className="page-how" onClick={() => setGuideOpen(true)} title="The three things to know about this page.">How it works</Button>
          )}
        </header>
        {children}
      </div>
      {guide && guideOpen && <Guide spec={guide} onClose={() => setGuideOpen(false)} />}
    </main>
  );
}

// ---------- The next-step bar ----------

export type NextTone = 'stop' | 'go' | 'quiet' | 'warn';

/**
 * The page's one next step. `tone` dresses it: stop (it waits for you: the hand), go (a go / no go
 * decision), warn (held, or near a limit) and quiet (nothing to do). The words say which.
 */
export function NextBar({ tone = 'go', icon, label, say, sub, children, className = '', line = false }: {
  tone?: NextTone;
  /** One line of a fixed height: the sentence and its note side by side (Jobs). */
  line?: boolean;
  icon: IconName;
  /** A small word above the sentence, such as "Go / no go" (Play full and subtle only). */
  label?: string | null;
  say: ReactNode;
  sub?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`next-bar tone-${tone}${line ? ' is-line' : ''} ${className}`.trim()} aria-label="Next step">
      <span className="next-icon"><Icon name={icon} size={line ? 18 : 22} /></span>
      <div className="next-say">
        {label && <span className="next-label">{label}</span>}
        <b className="next-head">{say}</b>
        {sub && <span className="next-sub">{sub}</span>}
      </div>
      {children && <div className="next-actions">{children}</div>}
    </section>
  );
}

// ---------- Folded sections ----------

export function Fold({ icon, name, note, children, open: startOpen = false, id }: {
  icon: IconName;
  name: string;
  note?: ReactNode;
  children: ReactNode;
  open?: boolean;
  /** Remember open or closed in this browser under this name. */
  id?: string;
}) {
  const [stored, setStored] = useStored(`gc.fold.${id ?? '-'}`);
  const open = stored === 'open' ? true : stored === 'closed' ? false : startOpen;
  return (
    <details className="fold" open={open} onToggle={(e) => { if (id) setStored(e.currentTarget.open ? 'open' : 'closed'); }}>
      <summary className="fold-head" title={`Show or hide ${name.toLowerCase()}.`}>
        <Icon name={icon} size={16} />
        <span className="fold-name">{name}</span>
        {note !== undefined && note !== null && <span className="muted fold-note">· {note}</span>}
        <FoldShow />
      </summary>
      <div className="fold-body">{children}</div>
    </details>
  );
}

/** The words at the end of a fold's head: Show, or Hide once open, with the app's chevron. */
export function FoldShow() {
  return (
    <span className="fold-show" aria-hidden="true">
      <span className="when-closed">Show</span><span className="when-open">Hide</span>
      <Icon name="chevron-down" size={14} className="fold-chevron" />
    </span>
  );
}

// ---------- Empty states ----------

export function Hero({ icon, title, children, actions, quiet = false }: { icon: IconName; title: string; children?: ReactNode; actions?: ReactNode; quiet?: boolean }) {
  return (
    <section className="hero" aria-label={title}>
      <span className={`hero-pic${quiet ? ' is-quiet' : ''}`}><Icon name={icon} size={40} /></span>
      <h3 className="hero-title">{title}</h3>
      {children && <div className="hero-say">{children}</div>}
      {actions && <div className="hero-actions">{actions}</div>}
    </section>
  );
}

// ---------- The first-visit guide ----------

export interface GuideCard { icons: IconName[]; title: string; say: string }
export interface GuideSpec { id: string; title: string; cards: [GuideCard, GuideCard, GuideCard]; done: string }

const SEEN_KEY = 'gc.guide.seen';

/** Whether a guide opens by itself on a page's first visit. Tests turn it off (test-setup.ts), as setCrewClock does for hats. */
let firstVisit = true;
export function setGuideFirstVisit(on: boolean) { firstVisit = on; }
/** Whether guides open by themselves on a first visit (off in tests); the review round's guide asks too. */
export const guideFirstVisit = () => firstVisit;
/** Whether this guide has been seen in this browser; markGuideSeen remembers it. */
export const guideSeen = (id: string) => readSeen().includes(id);
export function markGuideSeen(id: string) {
  const seen = readSeen();
  if (!seen.includes(id)) { try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen, id])); } catch { /* private window: shows again next time */ } }
}

function readSeen(): string[] {
  try { const v = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

/** Open the first time a page with this guide opens in this browser; How it works opens it again. */
function useGuide(id: string | null): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => (id && firstVisit ? !readSeen().includes(id) : false));
  const set = (next: boolean) => {
    if (!next && id) {
      const seen = readSeen();
      if (!seen.includes(id)) { try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen, id])); } catch { /* private window: shows again next time */ } }
    }
    setOpen(next);
  };
  return [open, set];
}

/** The three cards as the guide shows them, also used by empty states. */
export function GuideCards({ cards }: { cards: readonly GuideCard[] }) {
  return (
    <ol className="guide-cards">
      {cards.map((c, i) => (
        <li key={c.title} className="guide-card">
          <span className="guide-pic" aria-hidden="true">
            {c.icons.map((name, n) => (
              <span key={`${name}-${n}`} className="guide-pic-part">{n > 0 && <Icon name="chevron-right" size={16} className="guide-arrow" />}<Icon name={name} size={28} /></span>
            ))}
          </span>
          <span className="guide-n">{i + 1} of {cards.length}</span>
          <b className="guide-title">{c.title}</b>
          <span className="muted">{c.say}</span>
        </li>
      ))}
    </ol>
  );
}

function Guide({ spec, onClose }: { spec: GuideSpec; onClose: () => void }) {
  const done = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    done.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); if (before?.isConnected) before.focus(); };
  }, [onClose]);
  return (
    <div className="sheet-backdrop guide-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="guide" role="dialog" aria-modal="true" aria-label={spec.title}>
        <header className="guide-head">
          <h3>{spec.title}</h3>
          <Button kind="quiet" onClick={onClose} title="Close this; How it works opens it again.">Skip</Button>
        </header>
        <GuideCards cards={spec.cards} />
        <footer className="guide-foot">
          <span className="muted">Open this again any time with How it works.</span>
          <Button ref={done} kind="primary" size="lg" onClick={onClose}>{spec.done}</Button>
        </footer>
      </section>
    </div>
  );
}

// ---------- Phone width ----------

export const NARROW = '(max-width: 760px)';

const media = (q: string) => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(q) : null);

/**
 * True while the window is at least `px` wide, live as it changes (false where it can't be asked, as
 * in tests). Wide windows get more columns, not wider ones (packet R): the Job page's side column
 * and the Desk's queue column from 1280 px, the Desk's job column from 1440 px.
 */
export function useMinWidth(px: number): boolean {
  const q = `(min-width: ${px}px)`;
  return useSyncExternalStore(
    (fn) => { const m = media(q); m?.addEventListener('change', fn); return () => m?.removeEventListener('change', fn); },
    () => media(q)?.matches ?? false,
    () => false,
  );
}
const narrowList = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(NARROW) : null);

/** True at phone width (the same 760 px as the CSS), live as the window changes. */
export function useNarrow(): boolean {
  return useSyncExternalStore(
    (fn) => { const m = narrowList(); m?.addEventListener('change', fn); return () => m?.removeEventListener('change', fn); },
    () => narrowList()?.matches ?? false,
    () => false,
  );
}
