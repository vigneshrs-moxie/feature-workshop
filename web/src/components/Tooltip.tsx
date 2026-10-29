// The one tooltip (packet R). No control shows the browser's own tooltip: <TooltipLayer/> (mounted
// once by the app) draws every `title` (and `data-tip`) in the app's look instead, after a short
// delay under the pointer and at once on keyboard focus.
//
// How: while an element with a title is under the pointer or has the keyboard focus, its title is
// set aside (so the browser has nothing to show) and drawn here as a role="tooltip" the element
// points at with aria-describedby; when the pointer or focus leaves, the title goes back exactly as
// it was. An element whose title is its only name (an icon-only button) keeps that name as an
// aria-label meanwhile. Outside those moments the page's markup is untouched, so screen readers
// and tests read the title as always.
//
// A trailing "(key: c)" or "(keys: g i)" in the words is drawn as key caps (only while the keys are
// on: Settings → Keys). Esc, a click, a scroll or the window losing focus hides the tooltip.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { readKeysSetting } from '../app/keysSetting';

const DELAY = 450;
/** After one tooltip hides, the next one under the pointer shows at once for this long. */
const WARM = 400;
const SELECTOR = '[title], [data-tip], [data-tip-held]';
const KEY_TAIL = /\s*\((?:key|keys): ([^)]+)\)\.?\s*$/;

export interface TipWords { text: string; keys: string[] }

/** The tooltip's words and key caps: "Start a new job (key: c)." → "Start a new job." and [c]. */
export function tipWords(raw: string, keysOn = true): TipWords {
  const m = KEY_TAIL.exec(raw);
  if (!m) return { text: raw.trim(), keys: [] };
  const text = raw.slice(0, m.index).trim();
  const ended = /[.!?…:]$/.test(text) || !text ? text : `${text}.`;
  return { text: ended, keys: keysOn ? m[1].split(/\s*(?:,| or )\s*/).filter(Boolean) : [] };
}

interface Shown { words: TipWords; rect: DOMRect; key: number }

export function TooltipLayer() {
  const [tip, setTip] = useState<Shown | null>(null);
  const id = 'app-tooltip';

  useEffect(() => {
    let el: HTMLElement | null = null;
    let held: string | null = null;
    let addedName = false;
    let addedDesc = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let watch: MutationObserver | null = null;
    let hiddenAt = 0;
    let n = 0;

    const words = (t: HTMLElement) => held ?? t.getAttribute('data-tip') ?? '';
    const show = () => {
      if (!el || !el.isConnected) return;
      const text = words(el);
      if (!text.trim()) return;
      if (!addedDesc) {
        const was = el.getAttribute('aria-describedby');
        if (!was?.split(/\s+/).includes(id)) { el.setAttribute('aria-describedby', was ? `${was} ${id}` : id); addedDesc = true; }
      }
      setTip({ words: tipWords(text, readKeysSetting().enabled), rect: el.getBoundingClientRect(), key: ++n });
    };
    const hide = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      setTip((t) => { if (t) hiddenAt = Date.now(); return null; });
    };
    /** Give the element its title back, as it was, and let go of it. */
    const release = () => {
      hide();
      watch?.disconnect(); watch = null;
      if (el) {
        if (held !== null && !el.hasAttribute('title')) el.setAttribute('title', held);
        el.removeAttribute('data-tip-held');
        if (addedName) el.removeAttribute('aria-label');
        if (addedDesc) {
          const rest = (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((x) => x && x !== id);
          if (rest.length) el.setAttribute('aria-describedby', rest.join(' ')); else el.removeAttribute('aria-describedby');
        }
      }
      el = null; held = null; addedName = false; addedDesc = false;
    };
    /** Set the title aside while the element is pointed at or focused. */
    const take = (t: HTMLElement) => {
      const title = t.getAttribute('title');
      if (title === null) return;
      held = title;
      t.removeAttribute('title');
      t.setAttribute('data-tip-held', '');
      const labelled = 'labels' in t && ((t as HTMLInputElement).labels?.length ?? 0) > 0;
      if (!labelled && !t.hasAttribute('aria-label') && !t.hasAttribute('aria-labelledby') && !(t.textContent ?? '').trim()) {
        t.setAttribute('aria-label', title);
        addedName = true;
      }
    };
    const begin = (t: HTMLElement, now: boolean) => {
      if (t === el) { if (now && !timer) show(); return; }
      release();
      el = t;
      take(t);
      // The page may change the title while it is set aside (a busy state): take the new one.
      watch = new MutationObserver(() => {
        if (!el) return;
        const fresh = el.getAttribute('title');
        if (fresh === null) return;
        held = fresh;
        el.removeAttribute('title');
        setTip((s) => (s ? { ...s, words: tipWords(fresh, readKeysSetting().enabled) } : s));
      });
      watch.observe(t, { attributes: true, attributeFilter: ['title'] });
      if (now || Date.now() - hiddenAt < WARM) show();
      else timer = setTimeout(() => { timer = null; show(); }, DELAY);
    };
    const target = (node: EventTarget | null): HTMLElement | null => (node instanceof Element ? node.closest<HTMLElement>(SELECTOR) : null);

    const onOver = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const t = target(e.target);
      if (t) begin(t, false);
      else if (el && !(document.activeElement === el)) release();
    };
    const onOut = (e: PointerEvent) => {
      if (!el) return;
      const to = e.relatedTarget;
      if (to instanceof Node && el.contains(to)) return;
      if (document.activeElement === el && focusVisible(el)) return;
      if (!(to instanceof Element) || !to.closest(SELECTOR)) release();
    };
    const onFocus = (e: FocusEvent) => {
      const t = target(e.target);
      // A field you type in shows its tooltip under the pointer only, never over what you type.
      if (t && e.target === t && !isField(t) && focusVisible(t)) begin(t, true);
    };
    const onBlur = (e: FocusEvent) => { if (el && e.target === el) release(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') hide(); };
    const onDown = () => hide();
    const onScroll = () => hide();
    document.addEventListener('pointerover', onOver, true);
    document.addEventListener('pointerout', onOut, true);
    document.addEventListener('focusin', onFocus, true);
    document.addEventListener('focusout', onBlur, true);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('blur', release);
    return () => {
      release();
      document.removeEventListener('pointerover', onOver, true);
      document.removeEventListener('pointerout', onOut, true);
      document.removeEventListener('focusin', onFocus, true);
      document.removeEventListener('focusout', onBlur, true);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('blur', release);
    };
  }, []);

  return tip ? createPortal(<Bubble id={id} tip={tip} />, document.body) : null;
}

const isField = (el: Element) => el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit'].includes(el.type)) || (el as HTMLElement).isContentEditable;

function focusVisible(el: Element): boolean {
  try { return el.matches(':focus-visible'); } catch { return true; }
}

/** The tooltip itself: under the element, or over it when there's no room below; kept on screen. */
function Bubble({ id, tip }: { id: string; tip: Shown }) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number; above: boolean } | null>(null);
  useLayoutEffect(() => {
    const b = ref.current;
    if (!b) return;
    const r = tip.rect;
    const w = b.offsetWidth;
    const h = b.offsetHeight;
    const gap = 6;
    const above = r.bottom + gap + h > window.innerHeight - 8 && r.top - gap - h > 8;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    setPlace({ left, top: above ? r.top - gap - h : r.bottom + gap, above });
  }, [tip]);
  return (
    <div
      ref={ref}
      id={id}
      role="tooltip"
      className={`app-tip${place?.above ? ' is-above' : ''}`}
      style={place ? { left: place.left, top: place.top } : { left: 0, top: 0, visibility: 'hidden' }}
    >
      <span className="app-tip-text">{tip.words.text}</span>
      {tip.words.keys.length > 0 && (
        <span className="app-tip-keys"><span className="sr-only">Key: </span>{tip.words.keys.map((k) => <kbd key={k} className="app-tip-key">{k}</kbd>)}</span>
      )}
    </div>
  );
}
