// The Ship stop's next-step bar while a pull request is in review (packet Q): what is happening in
// one sentence, the line under it, and the round's one next action with its key. Its words and
// buttons come from the dashboard (GET /api/review/:slug bar): Fix with the Foreman (a) / Leave it
// for now (r); Send back (a) / Not yet (r); Try again from here; Merge PR #2… (m), which always
// shows the ask first (a hard line: the a key never merges); Remind Raj… (a comment, shown before
// it is sent); Ask for a review with the route's reviewer filled in. Play full and subtle say
// "Go: …" / "No go: …"; Play off says the plain words. While the Foreman works, a console line
// (Play full and subtle) gives the last thing done and how far along.
import { useState } from 'react';
import type { ReviewAction, ReviewView } from '../../api/types';
import { useKeyScope, type KeyId } from '../../app/keyRegistry';
import { useUi } from '../../app/ui';
import { Icon } from '../../components/Icon';
import { Kbd } from '../../components/Kbd';
import { NextBar } from '../../components/page/Page';
import { Sheet } from '../../components/Sheet';
import { usePlay } from '../../play/usePlay';
import { barLook } from './words';

type Act = (action: string, body?: Record<string, unknown>) => Promise<boolean>;

const KEY_ID: Record<string, KeyId> = { a: 'review-go', r: 'review-no-go', o: 'review-open', p: 'review-pr', m: 'review-merge' };

/** Where a client action's link goes, or null. */
export function linkFor(a: ReviewAction, view: ReviewView): string | null {
  if (a.id === 'open-pr') return view.pr.url;
  if (a.id === 'open-follow-up') return view.followUp?.url ?? null;
  if (a.id === 'open-base' && view.pr.url && view.pr.base) return view.pr.url.replace(/\/pull\/\d+.*$/, `/tree/${encodeURIComponent(view.pr.base)}`);
  return null;
}

/** The panel's id on the page, for Open the round (o). */
export const panelId = (slug: string) => `review-panel-${slug}`;
export const scrollToPanel = (slug: string) => {
  const el = document.getElementById(panelId(slug));
  el?.scrollIntoView?.({ block: 'start' });
  el?.focus?.({ preventScroll: true });
};

/** The body each action posts: the go comes with the actions that write or start something. */
export function bodyFor(a: ReviewAction, view: ReviewView): Record<string, unknown> {
  if (a.id === 'send') return { go: true, ...(typeof view.send?.mergeFollowUp === 'boolean' ? { mergeFollowUp: view.send.mergeFollowUp } : {}) };
  if (a.go === true && a.id !== 'fix' && a.id !== 'add-new') return { go: true };
  return {};
}

export function ReviewBar({ view, act, problem, keys = true }: { view: ReviewView; act: Act; problem: string | null; keys?: boolean }) {
  const play = usePlay();
  const ui = useUi();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState<'merge' | 'remind' | null>(null);
  const [login, setLogin] = useState<string>(view.bar?.reviewer?.login ?? '');
  const bar = view.bar!;
  const look = barLook(view.state === 'held' ? 'held' : view.state);
  const run = async (a: ReviewAction) => {
    if (!a.enabled || busy) return;
    if (a.client) {
      if (a.id === 'open') { scrollToPanel(view.slug); return; }
      if (a.id === 'drop') { ui.openSheet({ kind: 'close-job', slug: view.slug }); return; }
      const href = linkFor(a, view);
      if (href) window.open(href, '_blank', 'noopener');
      return;
    }
    if (a.confirm) { setAsking('merge'); return; }
    if (a.id === 'remind') { setAsking('remind'); return; }
    setBusy(true);
    try { await act(a.id, a.id === 'ask-review' ? { go: true, login: login.trim() } : bodyFor(a, view)); } finally { setBusy(false); }
  };
  const byKey = (k: string, pick: (a: ReviewAction) => boolean) => bar.actions.find((a) => a.key === k && a.enabled && pick(a));
  useKeyScope('review', {
    'review-go': () => { const a = byKey('a', (x) => x.go === true && !x.confirm); if (!a) return false; void run(a); },
    'review-no-go': () => { const a = byKey('r', (x) => x.go === false && !x.client); if (!a) return false; void run(a); },
    'review-open': () => { if (!view.round) return false; scrollToPanel(view.slug); },
    'review-pr': () => { if (!view.pr.url) return false; window.open(view.pr.url, '_blank', 'noopener'); },
    'review-merge': () => { const a = bar.actions.find((x) => x.key === 'm' && x.enabled && x.confirm); if (!a) return false; setAsking('merge'); },
  }, keys && !asking);

  // On the Ship stop the round is right under the bar: Open the round is its key (o), not a button.
  const shown = bar.actions.filter((a) => a.id !== 'open');
  const ordered = [...shown.filter((a) => a.client && a.go === null), ...shown.filter((a) => !a.client && a.go === null), ...shown.filter((a) => a.go === false), ...shown.filter((a) => a.go === true)];
  const hasGo = shown.some((a) => a.go !== null && !a.client);
  const off = shown.find((a) => !a.enabled && a.reason);
  const sub = [bar.detail, view.state === 'asked' ? bar.hint : null].filter(Boolean).join(' ');
  const label = view.state === 'held' ? 'Held in a terminal' : hasGo ? (play.on ? 'Go / no go' : 'Waiting for you') : null;
  const merge = bar.actions.find((a) => a.confirm)?.confirm ?? null;

  const button = (a: ReviewAction) => {
    const words = play.on && a.go !== null && !a.client ? a.playLabel : a.label;
    const kbd = a.key && KEY_ID[a.key] ? <Kbd id={KEY_ID[a.key]} /> : null;
    const cls = `btn btn-lg${a.go === true || (a.confirm && a.enabled) ? ' btn-primary' : a.client ? ' btn-quiet' : ''}`;
    const title = !a.enabled ? a.reason ?? 'Off for now.' : a.confirm ? `${a.label} Shows the exact step first; nothing merges until you say go there (key: m).` : a.key ? `${a.label} (key: ${a.key}).` : a.label;
    const href = a.client ? linkFor(a, view) : null;
    if (href) return <a key={a.id} className={cls} href={href} target="_blank" rel="noopener noreferrer" title={title}><Icon name="external" size={16} /> {words} {kbd}</a>;
    return (
      <button key={a.id} type="button" className={cls} disabled={!a.enabled || busy} onClick={() => void run(a)} title={title} data-review-action={a.id}>
        {words} {kbd}
      </button>
    );
  };

  return (
    <div className={`review-bar is-${view.state}${look.fail ? ' is-fail' : ''}`}>
      <NextBar tone={look.tone} icon={look.icon} label={label} say={bar.headline} sub={sub || undefined} className={look.fail ? 'tone-fail' : ''}>
        {ordered.map(button)}
      </NextBar>
      {view.state === 'no-reviewer' && (
        <label className="review-ask">
          <span>Their GitHub name</span>
          <input type="text" className="text-input" value={login} onChange={(e) => setLogin(e.target.value)} placeholder="their-github-name" aria-label="Who to ask for a review: their GitHub name" />
          <span className="muted">{bar.reviewer?.name ? `Filled in from the route (${bar.reviewer.name}). Change it to ask someone else.` : 'The route names nobody: type who should review it.'}</span>
        </label>
      )}
      {view.state === 'held' && bar.was && <p className="muted review-was">Underneath: {bar.was.headline}.</p>}
      {off && <p className="muted review-reason"><Icon name="lock" size={14} /> {off.reason}</p>}
      {view.state === 'fixing' && play.on && <ForemanConsole view={view} blink={play.full} />}
      {problem && <p className="field-problem" role="alert">{problem}</p>}
      {asking === 'merge' && merge && (
        <Sheet title={merge.headline} onClose={() => setAsking(null)} busy={busy} className="review-ask-sheet">
          <p className="review-ask-label"><span className="next-label">{play.on ? 'Go / no go' : 'Asks first'} · {merge.hardLine}</span> <span className="chip review-hard"><Icon name="alert" size={14} /> {merge.hardLine}</span></p>
          <div className="review-step"><span className="muted">The exact step</span><code>{merge.step}</code></div>
          <div className="review-goes">
            <p><b><Icon name="check" size={14} /> Go</b> Merges {view.pr.label} into {view.pr.base ?? 'its base'}. The job goes on to the next stop on the route.</p>
            <p><b><Icon name="x" size={14} /> No go</b> Nothing happens. The job stays in Ready to merge.</p>
          </div>
          <div className="sheet-actions">
            <span className="muted"><Icon name="alert" size={14} /> {merge.keyNote}</span>
            <button type="button" className="btn btn-lg" disabled={busy} onClick={() => setAsking(null)}>{play.on ? 'No go' : merge.noGo.label} <kbd className="kbd key-hint" aria-hidden="true">Esc</kbd></button>
            <button
              type="button"
              className="btn btn-primary btn-lg"
              disabled={busy}
              onClick={async () => { setBusy(true); try { if (await act('merge', { go: true, confirm: `merge ${view.pr.label}` })) setAsking(null); } finally { setBusy(false); } }}
            >
              {play.on ? merge.go.playLabel : merge.go.label}
            </button>
          </div>
          {problem && <p className="field-problem" role="alert">{problem}</p>}
        </Sheet>
      )}
      {asking === 'remind' && view.remind && <RemindSheet view={view} act={act} problem={problem} onClose={() => setAsking(null)} />}
    </div>
  );
}

function RemindSheet({ view, act, problem, onClose }: { view: ReviewView; act: Act; problem: string | null; onClose(): void }) {
  const [text, setText] = useState(view.remind?.text ?? '');
  const [busy, setBusy] = useState(false);
  const who = view.merge?.who ?? 'them';
  return (
    <Sheet title={`Remind ${who} to merge ${view.pr.label}?`} onClose={onClose} busy={busy} className="review-ask-sheet">
      <p className="next-label">A comment from you on {view.pr.label}</p>
      <textarea className="text-input review-remind-text" rows={4} value={text} onChange={(e) => setText(e.target.value)} aria-label="The comment, as it will be posted" data-autofocus />
      <p className="muted">{view.remind?.note}</p>
      <div className="sheet-actions">
        <button type="button" className="btn btn-lg" disabled={busy} onClick={onClose}>Cancel <kbd className="kbd key-hint" aria-hidden="true">Esc</kbd></button>
        <button
          type="button"
          className="btn btn-primary btn-lg"
          disabled={busy || !text.trim()}
          onClick={async () => { setBusy(true); try { if (await act('remind', { go: true, text: text.trim() })) onClose(); } finally { setBusy(false); } }}
        >
          Post the comment
        </button>
      </div>
      {problem && <p className="field-problem" role="alert">{problem}</p>}
    </Sheet>
  );
}

/** The console line while the Foreman works: how far along and the last thing done (it blinks in Play full). */
function ForemanConsole({ view, blink }: { view: ReviewView; blink: boolean }) {
  const c = view.round?.counts;
  const pct = c && c.included ? Math.round((c.done / c.included) * 100) : 0;
  return (
    <div className="review-console" role="status">
      <span className={`review-console-light${blink ? ' is-blink' : ''}`} aria-hidden="true" />
      <span className="review-console-where">{view.pr.label} · round {view.round?.round ?? 1}</span>
      <span className="review-console-last">{view.bar?.doing ? `Now: ${view.bar.doing}` : view.bar?.progress ?? ''}</span>
      <span className="review-meter" role="meter" aria-label="How far along" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={view.bar?.progress ?? `${pct}%`}><span style={{ width: `${pct}%` }} /></span>
    </div>
  );
}
