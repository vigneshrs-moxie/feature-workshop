// One stack (#/stack/<slug>), built from the approved Stack wireframe: the title and its ticket, How
// it works and Stack settings; the progress picture (the merge map, or four big steps: Settings →
// Look); each step in one plain line; the next-step bar with its one button (Approve plan a, Merge
// part m, Push p, Open part o, Let the Foreman fix it f, and Change something / Not yet r); the part
// cards in merge order, each with Details ▸; and History. Push asks go / no go in a box of its own,
// always, whatever "Merge on its own" says. The plan check also says why the plan splits the work
// this way. Play full dresses it as a console (the grid, a pulsing dot, the "Go / no go" word);
// subtle keeps the cards with a steady light; off is plain. The map and every word are the same.
// Data: GET /api/stacks/:slug and its POSTs (dashboard/site/routes-stacks.js).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { StackPart, StackView } from '../../api/types';
import { useKeyScope, type KeyId } from '../../app/keyRegistry';
import { readKeysSetting, useKeysSetting } from '../../app/keysSetting';
import { jobHref, navigate, stacksHref } from '../../app/router';
import { Icon } from '../../components/Icon';
import { Kbd } from '../../components/Kbd';
import { Fold, NextBar, Page, useNarrow } from '../../components/page/Page';
import { Sheet } from '../../components/Sheet';
import { usePlay } from '../../play/usePlay';
import { MergeMap, StepLines, StepsPicture, useStackPicture } from './StackPicture';
import { StackGuide, useStackGuide } from './StackGuide';
import { nextStep, partLook, parts, partTitle, PART, splitWhy, STUCK_AT, type StackAction, type StackButton } from './stackModel';
import { useStackView, type StackState } from './useStacks';
import './stack.css';

const clock = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export function StackPage({ slug }: { slug: string }) {
  const stack = useStackView(slug);
  const [guideOpen, setGuideOpen] = useStackGuide();
  const { view, missing, error } = stack;
  const title = view?.title || slug;
  const guide = guideOpen && <StackGuide done={view?.approved ? 'Show me the stack' : 'Show me the plan'} onClose={() => setGuideOpen(false)} />;
  if (!view) {
    return (
      <Page label="Stack" title={missing ? 'No such stack' : title} className="page-stack">
        {missing ? (
          <section className="stack-empty">
            <p>There’s no stack called “{slug}”. {missing}</p>
            <a className="btn btn-lg" href={stacksHref()}>Back to Stacks</a>
          </section>
        ) : error ? (
          <section className="stack-empty" role="alert">
            <p>Couldn’t load the stack: {error}</p>
            <button type="button" className="btn btn-lg" onClick={stack.refresh}>Try again</button>
          </section>
        ) : <p className="muted" role="status">Loading the stack…</p>}
      </Page>
    );
  }
  return <StackBody stack={stack} view={view} guide={guide} onHow={() => setGuideOpen(true)} />;
}

function StackBody({ stack, view, guide, onHow }: { stack: StackState; view: StackView; guide: ReactNode; onHow: () => void }) {
  const play = usePlay();
  const narrow = useNarrow();
  const [picture] = useStackPicture();
  const [sheet, setSheet] = useState<null | 'settings' | 'push' | { note: 'plan' } | { note: 'not-yet'; section: string }>(null);
  const [failedOpen, setFailedOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ cap: number; autoIntegrate: boolean }>({ cap: view.cap, autoIntegrate: view.autoIntegrate });
  const next = nextStep(view);
  const mode = play.full ? 'full' : play.on ? 'subtle' : 'off';

  function run(a: StackAction) {
    switch (a.kind) {
      case 'approve': void stack.act('approve-plan', { cap: draft.cap, autoIntegrate: draft.autoIntegrate }); break;
      case 'change': setSheet({ note: 'plan' }); break;
      case 'not-yet': setSheet({ note: 'not-yet', section: a.section }); break;
      case 'merge': void stack.act('merge', { section: a.section }); break;
      case 'push': setSheet('push'); break;
      case 'open-part': navigate({ name: 'job', slug: a.slug }); break;
      case 'open-job': navigate({ name: 'job', slug: view.slug }); break;
      case 'fix': void stack.act('send-back', { section: a.section }); break;
      case 'fix-plan': void stack.act('send-back', { note: `Please fix the stack plan (stack.md): ${view.plan?.errors.join(' ') ?? ''}`.trim() }); break;
      case 'see-failed': setFailedOpen((o) => (o === a.section ? null : a.section)); break;
      case 'editor': window.open(a.href, '_self'); break;
    }
  }

  // The bar's keys: only the ones its buttons offer right now, and never while a box is open.
  const keyed = [next.primary, next.second].filter((b): b is StackButton => Boolean(b?.key) && !b!.disabled);
  const handlers: Partial<Record<KeyId, () => void>> = {};
  for (const b of keyed) handlers[b.key!] = () => { if (!stack.sending) run(b.action); };
  useKeyScope('stack', handlers, sheet === null);

  const button = (b: StackButton | null, primary: boolean) => b && (
    <button
      type="button"
      className={`btn btn-lg${primary ? ' btn-primary' : ''}`}
      disabled={b.disabled || stack.sending}
      onClick={() => run(b.action)}
      title={b.hint}
    >
      {b.label}{b.key && <Kbd id={b.key} />}
    </button>
  );

  const failedPart = view.parts.find((p) => p.name === failedOpen);
  const showSteps = picture === 'steps' || narrow;
  return (
    <Page
      label="Stack"
      title={view.title || view.slug}
      className={`page-stack play-${mode}`}
      head={(
        <>
          {view.ticketKey && <span className="chip num">{view.ticketKey}</span>}
          <span className="spacer" />
          <button type="button" className="btn btn-quiet" onClick={onHow} title="The three things to know about stacks.">
            <Icon name="help" size={16} /> How it works
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => setSheet('settings')} title="Parts at once and Merge on its own, for this stack.">
            <Icon name="settings" size={16} /> Stack settings
          </button>
        </>
      )}
    >
      {showSteps ? <StepsPicture view={view} /> : <MergeMap view={view} grid={play.full} pulse={play.animated} />}
      <StepLines view={view} />
      <NextBar tone={next.tone} icon={next.icon} label={next.call && play.on ? 'Go / no go' : null} say={next.say} sub={next.sub} className={next.problem ? 'stack-bar-problem' : ''}>
        {(next.primary || next.second) && <>{button(next.second, false)}{button(next.primary, true)}</>}
      </NextBar>
      {stack.problem && (
        <p className="field-problem stack-problem" role="alert">
          {stack.problem} <button type="button" className="btn btn-quiet" onClick={stack.clearProblem}>Dismiss</button>
        </p>
      )}
      {failedPart?.problem?.tail && (
        <section className="stack-failed" aria-label="What failed">
          <b>What failed after merging {PART.one} {failedPart.n}</b>
          <pre className="stack-tail">{failedPart.problem.tail}</pre>
        </section>
      )}
      {!view.approved && view.plan?.ok && <WhySplit view={view} />}
      {view.approved && view.plan?.changedSinceApproval && (
        <p className="muted stack-note"><Icon name="warn" size={14} /> The plan file changed after you approved it. The parts already started keep their brief; ask the Foreman if that matters.</p>
      )}
      {view.plan && !view.plan.ok && (
        <ul className="stack-plan-errors" aria-label="What to fix in the plan">
          {view.plan.errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}
      <ol className={`stack-parts play-${mode}`} aria-label={`The ${PART.many}, in merge order`}>
        {view.parts.map((p) => <PartCard key={p.name} part={p} view={view} mode={mode} pulse={play.animated} />)}
      </ol>
      <Fold icon="clock" name="History" note={`${view.log.length} ${view.log.length === 1 ? 'event' : 'events'}`} id={`stack-history-${view.slug}`}>
        {view.log.length ? (
          <ol className="stack-history">
            {view.log.map((l, i) => <li key={`${l.at}-${i}`}><span className="muted num">{clock(l.at)}</span> {l.words}</li>)}
          </ol>
        ) : <p className="muted">Nothing has happened yet. Each step lands here, newest first.</p>}
      </Fold>
      {sheet === 'settings' && (
        <SettingsSheet
          view={view}
          draft={draft}
          onClose={() => setSheet(null)}
          onSave={async (s) => {
            if (!view.approved) { setDraft(s); setSheet(null); return; }
            if (await stack.act('settings', s)) setSheet(null);
          }}
        />
      )}
      {sheet === 'push' && <PushBox view={view} play={play.on} sending={stack.sending} onClose={() => setSheet(null)} onGo={async () => { if (await stack.act('push', { go: true })) setSheet(null); }} />}
      {sheet && typeof sheet === 'object' && (
        <NoteSheet
          kind={sheet.note}
          part={sheet.note === 'not-yet' ? view.parts.find((p) => p.name === sheet.section) ?? null : null}
          sending={stack.sending}
          onClose={() => setSheet(null)}
          onSend={async (note) => {
            const ok = sheet.note === 'plan' ? await stack.act('send-back', { note }) : await stack.act('send-back', { section: sheet.section, note });
            if (ok) setSheet(null);
          }}
        />
      )}
      {guide}
    </Page>
  );
}

/** The plan check says why the plan splits the work this way. */
function WhySplit({ view }: { view: StackView }) {
  const lines = splitWhy(view);
  if (!lines.length) return null;
  return (
    <section className="stack-why" aria-label="Why the plan splits it this way">
      <b><Icon name="clipboard" size={14} /> Why these {PART.many}</b>
      {lines.map((l) => <p key={l}>{l}</p>)}
    </section>
  );
}

function PartCard({ part, view, mode, pulse }: { part: StackPart; view: StackView; mode: 'full' | 'subtle' | 'off'; pulse: boolean }) {
  const look = partLook(part, view);
  const word = view.approved ? look.word : look.cardWord;
  return (
    <li className={`stack-part tone-${look.tone}`}>
      <div className="stack-part-top">
        {mode !== 'off' && <span className={`job-light stack-light tone-${look.tone}${look.live ? ' is-on' : ''}${look.live && pulse ? ' is-blink' : ''}`} aria-hidden="true" />}
        <span className="part-n">{part.n}</span>
        <b className="stack-part-title" title={partTitle(part)}>{partTitle(part)}</b>
      </div>
      <span className="stack-bar" role="img" aria-label={`${Math.round(look.fill * 100)}% along`}>
        <span className={`stack-bar-fill tone-${look.tone}`} style={{ width: `${Math.round(look.fill * 100)}%` }} />
      </span>
      <div className="stack-part-foot">
        <span className={`chip part-chip tone-${look.tone}`}><Icon name={look.icon} size={13} /> {word.replace(/^✓ /, '')}</span>
        <span className="muted stack-readout">{look.readout}</span>
      </div>
      <details className="stack-details">
        <summary title={`The files ${PART.one} ${part.n} may change, its branch and port.`}>Details</summary>
        <dl>
          {part.brief && <><dt>What it builds</dt><dd>{part.brief}</dd></>}
          {part.reason && <><dt>Now</dt><dd>{part.reason}</dd></>}
          <dt>Files it may change</dt>
          <dd><ul className="stack-files">{part.owns.map((o) => <li key={o} className="num">{o}</li>)}</ul></dd>
          <dt>Waits for</dt>
          <dd>{part.dependsOn.length ? part.dependsOn.map((d) => { const x = view.parts.find((q) => q.name === d); return x ? `${PART.one} ${x.n} (${d})` : d; }).join(', ') : 'Nothing: it can start at once'}</dd>
          <dt>Name in the plan</dt><dd className="num">{part.name}</dd>
          {part.branch && <><dt>Branch</dt><dd className="num">{part.branch}</dd></>}
          {part.worktree && <><dt>Its copy of the code</dt><dd className="num">{part.worktree}</dd></>}
          {part.port && <><dt>Port</dt><dd className="num">{part.port}</dd></>}
          <dt>Model</dt><dd>{part.model ?? view.model}, effort {part.effort ?? view.effort}</dd>
          {part.failures > 0 && <><dt>Failed checks</dt><dd>{part.failures} of {STUCK_AT}</dd></>}
          {part.problem?.files?.length ? <><dt>Files</dt><dd><ul className="stack-files">{part.problem.files.map((f) => <li key={f} className="num">{f}</li>)}</ul></dd></> : null}
        </dl>
        {part.slug && <a className="btn btn-quiet" href={jobHref(part.slug)}>Open {PART.one} {part.n}’s job <Icon name="chevron-right" size={14} /></a>}
      </details>
    </li>
  );
}

function SettingsSheet({ view, draft, onClose, onSave }: { view: StackView; draft: { cap: number; autoIntegrate: boolean }; onClose: () => void; onSave: (s: { cap: number; autoIntegrate: boolean }) => void }) {
  const [cap, setCap] = useState(String(view.approved ? view.cap : draft.cap));
  const [auto, setAuto] = useState(view.approved ? view.autoIntegrate : draft.autoIntegrate);
  const n = Number(cap);
  const ok = Number.isInteger(n) && n >= 1 && n <= 20;
  return (
    <Sheet title="Stack settings" onClose={onClose}>
      <form className="stack-settings" onSubmit={(e) => { e.preventDefault(); if (ok) onSave({ cap: n, autoIntegrate: auto }); }}>
        {!view.approved && <p className="muted">These start with the plan: they’re used when you approve it.</p>}
        <label className="field">
          <span>{PART.many.charAt(0).toUpperCase() + PART.many.slice(1)} at once</span>
          <input className="text-input" type="number" min={1} max={20} value={cap} onChange={(e) => setCap(e.target.value)} />
        </label>
        <p className="muted">How many {PART.many} of this stack build at the same time. Across every stack it is also at most {view.globalCap} (Settings → Workflow); {view.globalRunning} build now.</p>
        {!ok && <p className="field-problem">Pick a whole number from 1 to 20.</p>}
        <label className="rule-option">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          <span className="rule-option-body">
            <span className="rule-option-kind">Merge on its own</span>
            <span className="muted">A finished {PART.one} merges by itself when it is next in order, and the tests run after. Pushing still waits for your go.</span>
          </span>
        </label>
        <div className="sheet-actions">
          <button type="button" className="btn btn-lg" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary btn-lg" disabled={!ok}>Save</button>
        </div>
      </form>
    </Sheet>
  );
}

function NoteSheet({ kind, part, sending, onClose, onSend }: { kind: 'plan' | 'not-yet'; part: StackPart | null; sending: boolean; onClose: () => void; onSend: (note: string) => void }) {
  const [note, setNote] = useState('');
  const plan = kind === 'plan';
  const can = plan ? note.trim().length > 0 : true;
  return (
    <Sheet title={plan ? 'Change something in the plan' : `Not yet: ${PART.one} ${part?.n ?? ''}`} onClose={onClose} busy={sending}>
      <form className="stack-note-form" onSubmit={(e) => { e.preventDefault(); if (can) onSend(note.trim()); }}>
        <p className="muted">
          {plan
            ? 'Say what should change. The Foreman writes the plan again, and this page shows it for you to check.'
            : `Nothing is merged. ${part ? `${PART.one.charAt(0).toUpperCase()}${PART.one.slice(1)} ${part.n}` : 'The part'} goes back to its Foreman with your note, and comes back here when its checks pass again.`}
        </p>
        <textarea
          className="text-area"
          rows={4}
          value={note}
          data-autofocus
          placeholder={plan ? 'e.g. Put the email in its own part after the CSV writer.' : 'Why not yet? (optional)'}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && can) { e.preventDefault(); onSend(note.trim()); } }}
        />
        <div className="sheet-actions">
          <button type="button" className="btn btn-lg" onClick={onClose} disabled={sending}>Cancel</button>
          <button type="submit" className="btn btn-primary btn-lg" disabled={!can || sending}>{plan ? 'Send to the Foreman' : 'Send back'}</button>
        </div>
      </form>
    </Sheet>
  );
}

/** Go / no go before the push: three ticks, where it goes, and two big calls. p is Go here; Esc is No go. */
function PushBox({ view, play, sending, onClose, onGo }: { view: StackView; play: boolean; sending: boolean; onClose: () => void; onGo: () => void }) {
  const go = useRef<HTMLButtonElement>(null);
  const latest = useRef({ onClose, onGo, sending });
  latest.current = { onClose, onGo, sending };
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    go.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      if (e.key === 'Escape' && !latest.current.sending) { e.preventDefault(); latest.current.onClose(); }
      if ((e.key === 'p' || e.key === 'P') && !e.repeat && !latest.current.sending && readKeysSetting().enabled) { e.preventDefault(); latest.current.onGo(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); if (before?.isConnected) before.focus(); };
  }, []);
  const n = view.parts.length;
  const [{ enabled, hints }] = useKeysSetting();
  const hint = (k: string) => (enabled && hints ? <kbd className="kbd key-hint" aria-hidden="true">{k}</kbd> : null);
  return (
    <div className="sheet-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !sending) onClose(); }}>
      <section className="stack-push" role="dialog" aria-modal="true" aria-label="Push to GitHub?">
        {play && <span className="next-label">Go / no go</span>}
        <h3>Push to GitHub?</h3>
        <ul className="stack-ticks">
          <li><Icon name="check" size={14} /> {parts(n)} merged, in order</li>
          <li><Icon name="check" size={14} /> All tests pass</li>
          <li><Icon name="check" size={14} /> Each {PART.one} stayed in its own files</li>
        </ul>
        <p className="muted">Goes to <b>your fork</b>{view.parentBranch ? <> · <span className="num">{view.parentBranch}</span></> : null}. Never the team’s repository. The push asks for its own permission as usual.</p>
        <div className="stack-calls">
          <button type="button" className="btn btn-lg" onClick={onClose} disabled={sending} title="Nothing is pushed. You can push later from this page (Esc).">
            No go {hint('Esc')}
          </button>
          <button ref={go} type="button" className="btn btn-primary btn-lg" onClick={onGo} disabled={sending} title="Go: the Foreman pushes the branch to your fork (p).">
            Go: push {hint('p')}
          </button>
        </div>
      </section>
    </div>
  );
}
