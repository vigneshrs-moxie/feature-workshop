// One stack (#/stack/<slug>), redone for big features (packet V). From the top:
//   - the title, its ticket, the plan's "why" line and the progress bar from the home card, larger
//     (a segment per part, each a way to pick it), with the counts in words, time running, cost
//     and the last activity;
//   - one next-step bar with the one action (K2's: Approve plan a, Merge part m, Push p, Open part
//     o, Let the Foreman fix it f, Change something / Not yet r), and every problem state K2 drew;
//   - the parts, three ways (StackViews.tsx), remembered per stack: Board (the default), Map and
//     Timeline (keys 1, 2, 3). Full detail adds the timeline under the board;
//   - a part's quick look beside the view (PartPeek.tsx, the Desk's console): j / k through the
//     parts, Enter for its page, Esc to close, its one action in a row that never moves;
//   - Details (d): the stack's settings, its history of merges and undos, and the plan as written.
// Push asks go / no go in a box of its own, always, whatever "Merge on its own" says. Play full lays
// the Desk's grid behind the page and pulses the lights of parts at work; subtle keeps them
// steady; off is plain. Data: GET /api/stacks/:slug and its POSTs (dashboard/site/routes-stacks.js).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { StackPart, StackView } from '../../api/types';
import { useDetail } from '../../app/detail';
import { useKeyScope, type KeyId } from '../../app/keyRegistry';
import { readKeysSetting, useKeysSetting } from '../../app/keysSetting';
import { navigate, stacksHref } from '../../app/router';
import { Button } from '../../components/Button';
import { Choice } from '../../components/Choice';
import { Drawer } from '../../components/Drawer';
import { NumberInput } from '../../components/Field';
import { Icon, type IconName } from '../../components/Icon';
import { NextBar, Page } from '../../components/page/Page';
import { Sheet } from '../../components/Sheet';
import { useStored } from '../../lib/stored';
import { relativeTime, useNow } from '../../lib/time';
import { usePlay } from '../../play/usePlay';
import { PartPeek, type PartAction } from './PartPeek';
import { StackBar } from './StackBar';
import { StackGuide, useStackGuide } from './StackGuide';
import { countWords, money, runningFor, segmentsOf, withLanes } from './stackLook';
import { nextStep, parts, PART, splitWhy, type StackAction, type StackButton } from './stackModel';
import { Board, DepMap, Timeline, type StackViewKind } from './StackViews';
import { useStackView, type StackState } from './useStacks';
import './stack.css';
import './stacks-home.css';
import './stack-page.css';


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

function StackBody({ stack, view: raw, guide, onHow }: { stack: StackState; view: StackView; guide: ReactNode; onHow: () => void }) {
  const view = useMemo(() => withLanes(raw), [raw]);
  const play = usePlay();
  const now = useNow(30_000);
  const [detail] = useDetail();
  const [kind, setKind] = useStackViewKind(view.slug);
  const [mergedOpen, setMergedOpen] = useStored(`gc.stack.merged.${view.slug}`);
  const [sheet, setSheet] = useState<null | 'settings' | 'push' | { note: 'plan' } | { note: 'not-yet'; section: string } | { merge: string }>(null);
  const [details, setDetails] = useState(false);
  const [failedOpen, setFailedOpen] = useState<string | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [peek, setPeek] = useState(false);
  const [draft, setDraft] = useState<{ cap: number; autoIntegrate: boolean }>({ cap: view.cap, autoIntegrate: view.autoIntegrate });
  const next = nextStep(view);
  const mode = play.full ? 'full' : play.on ? 'subtle' : 'off';
  const pickedPart = picked ? view.parts.find((p) => p.n === picked) ?? null : null;

  function run(a: StackAction) {
    switch (a.kind) {
      case 'approve': void stack.act('approve-plan', { cap: draft.cap, autoIntegrate: draft.autoIntegrate }); break;
      case 'change': setSheet({ note: 'plan' }); break;
      case 'not-yet': setSheet({ note: 'not-yet', section: a.section }); break;
      case 'merge': void stack.act('merge', { section: a.section }); break;
      case 'push': setSheet('push'); break;
      case 'open-part': { const p = view.parts.find((x) => x.slug === a.slug); if (p) navigate({ name: 'stack-part', slug: view.slug, n: p.n }); else navigate({ name: 'job', slug: a.slug }); break; }
      case 'open-job': navigate({ name: 'job', slug: view.slug }); break;
      case 'fix': void stack.act('send-back', { section: a.section }); break;
      case 'fix-plan': void stack.act('send-back', { note: `Please fix the stack plan (stack.md): ${view.plan?.errors.join(' ') ?? ''}`.trim() }); break;
      case 'see-failed': setFailedOpen((o) => (o === a.section ? null : a.section)); break;
      case 'editor': window.open(a.href, '_self'); break;
    }
  }
  function partDo(a: PartAction, p: StackPart) {
    if (a.kind === 'merge') setSheet({ merge: p.name });
    else if (a.kind === 'fix') void stack.act('send-back', { section: p.name });
    else if (p.slug) navigate({ name: 'job', slug: p.slug });
  }
  const pick = (n: number) => { setPicked(n); setPeek(true); };
  const move = (by: number) => {
    const ns = view.parts.map((p) => p.n);
    if (!ns.length) return;
    const at = picked ? ns.indexOf(picked) : -1;
    setPicked(ns[(at + by + ns.length) % ns.length]);
    setPeek(true);
  };

  // The bar's keys: only the ones its buttons offer right now, and never while a box is open.
  const keyed = [next.primary, next.second].filter((b): b is StackButton => Boolean(b?.key) && !b!.disabled);
  const handlers: Partial<Record<KeyId, () => void>> = {};
  for (const b of keyed) handlers[b.key!] = () => { if (!stack.sending) run(b.action); };
  handlers['stacks-next'] = () => move(1);
  handlers['stacks-prev'] = () => move(-1);
  handlers['stacks-peek'] = () => { if (picked) setPeek((o) => !o); else move(1); };
  handlers['stacks-open'] = () => { if (picked) navigate({ name: 'stack-part', slug: view.slug, n: picked }); };
  handlers['stack-board'] = () => setKind('board');
  handlers['stack-map'] = () => setKind('map');
  handlers['stack-timeline'] = () => setKind('timeline');
  handlers['stack-details'] = () => setDetails(true);
  useKeyScope('stack', handlers, sheet === null && !details);
  // Esc closes the quick look (a sheet's own Esc comes first).
  useEffect(() => {
    if (!peek) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('[aria-modal="true"]')) { e.preventDefault(); setPeek(false); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [peek]);

  const button = (b: StackButton | null, primary: boolean) => b && (
    <Button size="lg" kind={primary ? 'primary' : 'secondary'} disabled={b.disabled || stack.sending} onClick={() => run(b.action)} title={b.hint} keyId={b.key} keyShown={primary}>
      {b.label}
    </Button>
  );

  const failedPart = view.parts.find((p) => p.name === failedOpen);
  const segments = segmentsOf(view);
  // The risks the next-step bar doesn't already say (it names the first one that needs you).
  const barPart = next.primary?.action && 'section' in next.primary.action ? view.parts.find((p) => p.name === (next.primary!.action as { section: string }).section)?.n : next.primary?.action.kind === 'open-part' ? view.parts.find((p) => p.slug === (next.primary!.action as { slug: string }).slug)?.n : undefined;
  const otherRisks = (view.risks ?? []).filter((r) => !(barPart !== undefined && r.parts.length === 1 && r.parts[0] === barPart) && !(next.problem && r === view.risks![0]));
  const ran = runningFor(view.startedAt, now);
  const viewProps = { view, picked: peek ? picked : picked, onPick: pick, now, mode, pulse: play.animated } as const;
  const mergingPart = sheet && typeof sheet === 'object' && 'merge' in sheet ? view.parts.find((p) => p.name === sheet.merge) ?? null : null;
  return (
    <Page
      label="Stack"
      title={view.title || view.slug}
      className={`page-stack-v play-${mode}${play.full ? ' has-grid' : ''}${peek && pickedPart ? ' has-peek' : ''}`}
      head={(
        <>
          {view.ticketKey && <span className="shc-ticket num">{view.ticketKey}</span>}
          <span className="spacer" />
          <Button kind="quiet" icon="help" onClick={onHow} title="The three things to know about stacks.">How it works</Button>
          <Button kind="quiet" icon="settings" onClick={() => setDetails(true)} keyId="stack-details" title="The stack’s settings, its plan as written and its history (key: d).">Details</Button>
        </>
      )}
    >
      {view.plan?.why && <p className="stack-why-line">{view.plan.why}</p>}
      {segments.length > 0 && (
        <section className="stack-progress" aria-label="Progress">
          <StackBar segments={segments} size="lg" onPick={(x) => pick(x.n)} picked={peek ? picked : null} />
          <div className="shc-counts">
            <span className="shc-count-words">{view.approved ? countWords(view.counts ?? {}, view.parts.length) : `${parts(view.parts.length)} planned · none started yet`}</span>
            <span className="shc-numbers num">
              {[ran && `${ran} running`, view.approved && money(view.costUsd), view.lastActivityAt && `last activity ${relativeTime(view.lastActivityAt, now)}`].filter(Boolean).map((t, i) => <span key={String(t)}>{i > 0 && <span className="shc-dot" aria-hidden="true">·</span>}{t}</span>)}
            </span>
          </div>
        </section>
      )}
      <NextBar tone={next.tone} icon={next.icon} label={next.call && play.on ? 'Go / no go' : null} say={next.say} sub={next.sub} className={next.problem ? 'stack-bar-problem' : ''}>
        {(next.primary || next.second) && <>{button(next.second, false)}{button(next.primary, true)}</>}
      </NextBar>
      {stack.problem && (
        <p className="field-problem stack-problem" role="alert">
          {stack.problem} <Button kind="quiet" size="sm" onClick={stack.clearProblem}>Dismiss</Button>
        </p>
      )}
      {failedPart?.problem?.tail && (
        <section className="stack-failed" aria-label="What failed">
          <b>What failed after merging {PART.one} {failedPart.n}</b>
          <pre className="stack-tail">{failedPart.problem.tail}</pre>
        </section>
      )}
      {otherRisks.length > 0 && (
        <ul className="stack-risks" aria-label="Also">
          {otherRisks.map((r) => <li key={r.words} className={`shc-risk tone-${r.tone}`}><Icon name={r.tone === 'error' ? 'warn' : 'alert'} size={14} /> <span>{r.words}</span></li>)}
        </ul>
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
      <div className="stack-toolbar">
        <div className="seg" role="tablist" aria-label="Show the parts as">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" role="tab" className="tab seg-tab" aria-selected={kind === v.id} onClick={() => setKind(v.id)} title={`${v.hint} (key: ${v.key}).`}>
              <Icon name={v.icon} size={14} /> {v.word}
            </button>
          ))}
        </div>
        <span className="stack-toolbar-note muted">{kind === 'board' ? 'Click a part, or use j and k, for a quick look.' : kind === 'map' ? 'Arrows run from a part to the parts that wait on it. Numbers are the merge order.' : 'Each part from its start to its merge. Now is the dashed line.'}</span>
      </div>
      <div className="stack-view-area">
        {kind === 'board' && <Board {...viewProps} mergedOpen={mergedOpen === 'open'} onMergedOpen={(o) => setMergedOpen(o ? 'open' : null)} />}
        {kind === 'map' && <DepMap {...viewProps} />}
        {kind === 'timeline' && <Timeline {...viewProps} />}
        {kind === 'board' && detail === 'full' && view.approved && (
          <section className="stack-full-timeline" aria-label="Timeline">
            <h3 className="stack-section-title">Timeline</h3>
            <Timeline {...viewProps} />
          </section>
        )}
      </div>
      {peek && pickedPart && <PartPeek view={view} part={pickedPart} now={now} play={play.on} busy={stack.sending} onAction={partDo} onClose={() => setPeek(false)} />}
      {details && (
        <Drawer title="Details" onRequestClose={() => setDetails(false)} className="stack-details-drawer">
          <StackDetails view={view} draft={draft} sending={stack.sending} onSave={async (s) => {
            if (!view.approved) { setDraft(s); return true; }
            return stack.act('settings', s);
          }} />
        </Drawer>
      )}
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
      {mergingPart && (
        <Sheet title={`Merge part ${mergingPart.n}?`} onClose={() => setSheet(null)} busy={stack.sending}>
          <p className="muted">Part {mergingPart.n} ({mergingPart.title ?? mergingPart.name}) joins {view.parentBranch ?? 'the stack’s branch'}, then the checks run. If they fail, the merge is undone and the part goes back to its Foreman. Nothing is pushed.</p>
          <div className="sheet-actions">
            <Button size="lg" onClick={() => setSheet(null)} disabled={stack.sending}>Not now</Button>
            <Button kind="primary" size="lg" busy={stack.sending} data-autofocus onClick={async () => { if (await stack.act('merge', { section: mergingPart.name })) setSheet(null); }}>Merge part {mergingPart.n}</Button>
          </div>
        </Sheet>
      )}
      {sheet === 'push' && <PushBox view={view} play={play.on} sending={stack.sending} onClose={() => setSheet(null)} onGo={async () => { if (await stack.act('push', { go: true })) setSheet(null); }} />}
      {sheet && typeof sheet === 'object' && 'note' in sheet && (
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

const VIEWS: { id: StackViewKind; word: string; icon: IconName; key: string; hint: string }[] = [
  { id: 'board', word: 'Board', icon: 'layers', key: '1', hint: 'The parts in columns by where they are' },
  { id: 'map', word: 'Map', icon: 'map', key: '2', hint: 'What each part waits on, left to right' },
  { id: 'timeline', word: 'Timeline', icon: 'clock', key: '3', hint: 'Each part from its start to its merge' },
];

/** Which view a stack opens on, remembered per stack in this browser (the board first). */
function useStackViewKind(slug: string): [StackViewKind, (k: StackViewKind) => void] {
  const [stored, setStored] = useStored(`gc.stack.view.${slug}`);
  const kind: StackViewKind = stored === 'map' || stored === 'timeline' ? stored : 'board';
  return [kind, (k) => setStored(k === 'board' ? null : k)];
}

/** Details: the stack's settings, the plan as written, and the history of merges and undos. */
function StackDetails({ view, draft, sending, onSave }: { view: StackView; draft: { cap: number; autoIntegrate: boolean }; sending: boolean; onSave: (s: { cap: number; autoIntegrate: boolean }) => Promise<boolean> }) {
  const [cap, setCap] = useState(String(view.approved ? view.cap : draft.cap));
  const [auto, setAuto] = useState(view.approved ? view.autoIntegrate : draft.autoIntegrate);
  const [saved, setSaved] = useState(false);
  const n = Number(cap);
  const ok = Number.isInteger(n) && n >= 1 && n <= 20;
  const changed = ok && (n !== (view.approved ? view.cap : draft.cap) || auto !== (view.approved ? view.autoIntegrate : draft.autoIntegrate));
  const merges = view.log.filter((l) => ['merged', 'checks-failed', 'conflict', 'outside', 'empty', 'stuck', 'pushed', 'push-approved', 'plan-approved'].includes(l.event));
  return (
    <div className="stack-details">
      <section aria-label="Settings">
        <h4 className="stack-section-title">Settings</h4>
        <form className="stack-settings" onSubmit={async (e) => { e.preventDefault(); if (ok && (await onSave({ cap: n, autoIntegrate: auto }))) { setSaved(true); window.setTimeout(() => setSaved(false), 1500); } }}>
          {!view.approved && <p className="muted">These start with the plan: they’re used when you approve it.</p>}
          <div className="field">
            <span className="field-label">Parts at once</span>
            <NumberInput value={cap} min={1} max={20} onChange={setCap} aria-label="Parts at once" />
          </div>
          <p className="muted">How many parts of this stack build at the same time. Across every stack it is also at most {view.globalCap} (Settings → Workflow); {view.globalRunning} build now.</p>
          {!ok && <p className="field-problem">Pick a whole number from 1 to 20.</p>}
          <label className="rule-option">
            <Choice type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            <span className="rule-option-body">
              <span className="rule-option-kind">Merge on its own</span>
              <span className="muted">A finished part merges by itself when it is next in order, and the tests run after. Pushing still waits for your go.</span>
            </span>
          </label>
          <div className="stack-details-save">
            {saved && <span className="muted" role="status">Saved</span>}
            <Button type="submit" kind="primary" disabled={!changed} busy={sending}>Save</Button>
          </div>
        </form>
      </section>
      <section aria-label="History">
        <h4 className="stack-section-title">History <span className="muted num">{merges.length}</span></h4>
        {merges.length ? (
          <ol className="stack-history">
            {merges.map((l, i) => <li key={`${l.at}-${i}`} className={`hist-${l.event}`}><time className="muted num" dateTime={l.at}>{dayClock(l.at)}</time> <span>{l.words}</span></li>)}
          </ol>
        ) : <p className="muted">Nothing has merged yet. Each merge, and each one undone, lands here with its time.</p>}
      </section>
      <section aria-label="The plan as written">
        <h4 className="stack-section-title">The plan as written <span className="muted">stack.md</span></h4>
        {view.plan?.text ? <pre className="stack-plan-text">{view.plan.text}</pre> : <p className="muted">There is no plan yet. The Foreman writes it.</p>}
      </section>
    </div>
  );
}

const dayClock = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

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

function SettingsSheet({ view, draft, onClose, onSave }: { view: StackView; draft: { cap: number; autoIntegrate: boolean }; onClose: () => void; onSave: (s: { cap: number; autoIntegrate: boolean }) => void }) {
  const [cap, setCap] = useState(String(view.approved ? view.cap : draft.cap));
  const [auto, setAuto] = useState(view.approved ? view.autoIntegrate : draft.autoIntegrate);
  const n = Number(cap);
  const ok = Number.isInteger(n) && n >= 1 && n <= 20;
  return (
    <Sheet title="Stack settings" onClose={onClose}>
      <form className="stack-settings" onSubmit={(e) => { e.preventDefault(); if (ok) onSave({ cap: n, autoIntegrate: auto }); }}>
        {!view.approved && <p className="muted">These start with the plan: they’re used when you approve it.</p>}
        <div className="field">
          <span className="field-label">{PART.many.charAt(0).toUpperCase() + PART.many.slice(1)} at once</span>
          <NumberInput value={cap} min={1} max={20} onChange={setCap} aria-label={`${PART.many.charAt(0).toUpperCase() + PART.many.slice(1)} at once`} />
        </div>
        <p className="muted">How many {PART.many} of this stack build at the same time. Across every stack it is also at most {view.globalCap} (Settings → Workflow); {view.globalRunning} build now.</p>
        {!ok && <p className="field-problem">Pick a whole number from 1 to 20.</p>}
        <label className="rule-option">
          <Choice type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
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
