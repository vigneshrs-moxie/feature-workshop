// The pieces every page of the new look is built from (packet M):
//   <Page>       the full-width page, its heading row and its body, at most --page-max wide
//   <NextBar>    the one next step: what it is in a sentence, and one big button with its key
//   <Guide>      the three-card "How it works", shown by itself the first time a page opens
//   <Fold>       a folded section with its count ("Resting · 2 idle   Show ▸")
//   <Hero>       an empty state: a picture, one sentence, one or two buttons
// Words carry the meaning everywhere; icons are decoration and colour never stands alone.
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
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
            <button type="button" className="btn btn-quiet page-how" onClick={() => setGuideOpen(true)} title="The three things to know about this page.">
              <Icon name="help" size={16} /> How it works
            </button>
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
export function NextBar({ tone = 'go', icon, label, say, sub, children, className = '' }: {
  tone?: NextTone;
  icon: IconName;
  /** A small word above the sentence, such as "Go / no go" (Play full and subtle only). */
  label?: string | null;
  say: ReactNode;
  sub?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`next-bar tone-${tone} ${className}`.trim()} aria-label="Next step">
      <span className="next-icon"><Icon name={icon} size={22} /></span>
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
        <span className="fold-show" aria-hidden="true"><span className="when-closed">Show ▸</span><span className="when-open">Hide ▾</span></span>
      </summary>
      <div className="fold-body">{children}</div>
    </details>
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
          <button type="button" className="btn btn-quiet" onClick={onClose} title="Close this; How it works opens it again.">Skip</button>
        </header>
        <GuideCards cards={spec.cards} />
        <footer className="guide-foot">
          <span className="muted">Open this again any time with How it works.</span>
          <button ref={done} type="button" className="btn btn-primary btn-lg" onClick={onClose}>{spec.done}</button>
        </footer>
      </section>
    </div>
  );
}

// ---------- Phone width ----------

export const NARROW = '(max-width: 760px)';
const narrowList = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(NARROW) : null);

/** True at phone width (the same 760 px as the CSS), live as the window changes. */
export function useNarrow(): boolean {
  return useSyncExternalStore(
    (fn) => { const m = narrowList(); m?.addEventListener('change', fn); return () => m?.removeEventListener('change', fn); },
    () => narrowList()?.matches ?? false,
    () => false,
  );
}
