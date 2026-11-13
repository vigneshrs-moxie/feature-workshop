// Your move (Task 9, R1 "the fast yes"): the card that asks him for a decision. The label and the
// ask paint from the snapshot row on the first paint (the same words the payload brings:
// waitingFor, waitingSince, headline) and from the payload's move after, so they do not change when
// it lands; what only the payload knows (the options, Go, the calls) fills in under them.
// A permission's or a question's ask has no text in the snapshot row, so on a cold open the row's
// headline shows until the payload brings the move's own words.
//
// - A gate: each question with its options, `recommended` on the Foreman's pick and already picked,
//   `Your own answer` last (a one-line field under the question). Go is awake at once and says what
//   it carries: `Go · all recommended`, `Go · 1 changed`. `n decided for you · confirmed by Go` with
//   `Look` (the decisions in the reader). The picks live in the store for this gate only
//   (jobStore forGate), so a payload that changes under him keeps them.
//   Go shows `Sent` at once, sends once however fast he clicks (or presses ⌘↵ or a), carries the
//   message box's words as the approval's note, and on a refusal puts the picks and the words back
//   with the reason in plain words. The body is gateBody.ts's: byte for byte today's card's.
// - A free-text ask: the replies the Foreman named in quotes are quick replies that fill the message
//   box. Nothing is sent until he presses Send.
// - A permission (or a crew question): what it wants, the exact command, `Allow once`, `Deny`,
//   `Always allow…` (today's sheet: POST /api/rules), `Allow for this run` where Claude Code offers
//   it. A hard line or a risky step has no key and no Always allow, as today's alert.
// - Nothing waits for him: one line.
//
// Keys (scope 'jobpage', only while the card waits): ⌘↵ Go from anywhere, the message box too;
// a Go, or Allow once; ↑ ↓ move through the options (outside the reader); Space picks the one moved to.

import { memo, useCallback, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ApiError } from '../../api/client';
import type { GateResult, Job, Permission } from '../../api/types';
import { BRAND } from '../../app/brand';
import { sendGate } from '../../app/jobActions';
import { pressKey, useKeyScope } from '../../app/keyRegistry';
import { readHref, replaceHash } from '../../app/router';
import { Button } from '../../components/Button';
import { Choice, OptionRow } from '../../components/Choice';
import { useNarrow } from '../../components/page/Page';
import { AlwaysAllowSheet } from '../../components/permissions/AlwaysAllowSheet';
import { useWorkshop } from '../../state/store';
import type { GateMove, PermissionMove, QuestionMove, ReaderTarget } from '../types';
import { useJob, useJobStore } from '../useJob';
import { changedCount, gateBody, OWN, pickOf, unanswered, type GatePicks } from './gateBody';
import { STATE_WORDS, stateFromRow } from './Header';

/** A time as "Fri 12:06 PM" (the reader's title rows use it too). */
export function sinceWords(at: string | null | undefined): string | null {
  if (!at) return null;
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

const DECISIONS: ReaderTarget = { kind: 'decisions', id: 'decisions' };

export interface YourMoveProps {
  job: Job | null;
  /** Open something in the reader (the page's own pick, so under 1100 px it comes over the left pane). */
  onOpen?(t: ReaderTarget, from?: HTMLElement | null): void;
}

export const YourMove = memo(function YourMove({ job, onOpen }: YourMoveProps) {
  const move = useJob((s) => s.payload?.move);
  const state = useJob((s) => s.payload?.state);
  const line = useJob((s) => s.payload?.stateLine);
  if (move === undefined) {
    // Before the payload: the snapshot row's words.
    if (!job) return <div className="jp2-ym" />;
    const st = stateFromRow(job);
    if (st === 'needs-you') return <div className="jp2-ym"><Card label={moveLabel(job.waitingFor === 'permission', job.waitingSince)} ask={job.headline || job.laneReason || 'This job waits for you.'} /></div>;
    return <div className="jp2-ym"><p className="jp2-ym-one">{STATE_WORDS[st]}{job.laneReason ? ` · ${job.laneReason}` : ''}</p></div>;
  }
  if (move?.kind === 'gate') return <div className="jp2-ym"><GateCard move={move} onOpen={onOpen} /></div>;
  if (move?.kind === 'question') return <div className="jp2-ym"><AskCard move={move} /></div>;
  if (move?.kind === 'permission') return <div className="jp2-ym"><PermissionCard key={move.id} move={move} /></div>;
  return <div className="jp2-ym"><p className="jp2-ym-one">{state ? STATE_WORDS[state] : ''}{line ? ` · ${line}` : ''}</p></div>;
});

/** Your move's label, the same from the snapshot row (waitingFor, waitingSince) and from the payload, so it does not change when the payload lands. */
function moveLabel(permission: boolean, at: string | null | undefined): string {
  const since = sinceWords(at);
  return `Needs you${permission ? ' · permission' : ''}${since ? ` · since ${since}` : ''}`;
}

function Card({ label, ask, children }: { label: string; ask: string; children?: ReactNode }) {
  return (
    <div className="jp2-card">
      <p className="jp2-card-label">{label}</p>
      <p className="jp2-card-ask">{ask}</p>
      {children}
    </div>
  );
}

// ---------- Go, sent once per job ----------

type GoPhase = 'sending' | 'sent' | 'held' | 'queued';
interface GoSent { key: string; phase: GoPhase; line: string; runId: string | null }

// Kept outside the page, by job: a page drawn again (a step pick, coming back from Jobs) still knows
// Go went, so it cannot be sent twice before the job moves on.
const goSent = new Map<string, GoSent>();
const goHeard = new Set<() => void>();
const tellGo = () => { for (const l of [...goHeard]) l(); };
function setGo(slug: string, sent: GoSent | null) {
  if (sent) goSent.set(slug, sent); else goSent.delete(slug);
  tellGo();
}
const listenGo = (l: () => void) => { goHeard.add(l); return () => { goHeard.delete(l); }; };

/** Forget every Go sent (between tests). */
export function forgetSentGo() {
  goSent.clear();
  tellGo();
}

/** Which gate a Go answered: its brief number, or its words when it has none. */
const gateKeyOf = (move: GateMove) => (move.brief !== null ? `gate:${move.brief}` : `gate:${move.ask}`);

const UNREACHABLE = `Couldn’t reach ${BRAND.name}. Try again.`;
const ENDED = new Set(['done', 'stopped', 'error', 'limited']);

/** The server's no, in plain words. */
function refusalWords(err: unknown): string {
  if (err instanceof TypeError) return UNREACHABLE;
  const code = err instanceof ApiError ? err.body.code : null;
  if (code === 'limited') return 'Not sent: Claude’s usage limit is reached. Your picks are kept; Go again once it resets.';
  if (code === 'terminal') return 'Not sent: this job’s Foreman was last used in your terminal. Carry on there, or close it in the terminal and Go again here.';
  if (code === 'terminal-open') return 'Not sent: Claude Code is open in this repository in a terminal. Tick the box below if none of those windows is this job’s Foreman, then Go again.';
  if (code === 'stale-gate') return 'Not sent: the spec or plan changed since this was shown. Read the new version, then decide.';
  if (code === 'stale-brief') return 'Not sent: the Foreman has moved on to a newer brief. Decide on the new one.';
  return `Not sent: ${err instanceof Error ? err.message : String(err)}`;
}

const NO_PICKS: Record<string, string> = {};

/** The calls' size: small on a laptop, a thumb's size on the phone. */
const useCallSize = () => (useNarrow() ? 'md' : 'sm');

// ---------- A gate ----------

function GateCard({ move, onOpen }: { move: GateMove; onOpen?: YourMoveProps['onOpen'] }) {
  const size = useCallSize();
  const store = useJobStore();
  const { api } = useWorkshop();
  const slug = useJob((s) => s.slug);
  const key = gateKeyOf(move);
  const picks = useJob((s) => (s.ui.picksFor === key ? s.ui.picks : NO_PICKS));
  const own = useJob((s) => (s.ui.picksFor === key ? s.ui.own : NO_PICKS));
  const limited = useJob((s) => Boolean(s.payload?.usage?.limited));
  const held = useJob((s) => Boolean(s.payload?.lock));
  const run = useJob((s) => s.payload?.run ?? null);
  const sentAny = useSyncExternalStore(listenGo, () => goSent.get(slug) ?? null);
  // A Go for another gate is over; one whose reply ended while this gate still waits gives the card back.
  const over = sentAny !== null && (sentAny.key !== key
    || (sentAny.phase === 'sent' && sentAny.runId !== null && run?.id === sentAny.runId && ENDED.has(run.status ?? '')));
  const sent = sentAny && !over ? sentAny : null;
  const [line, setLine] = useState<string | null>(null);
  const [askTerminal, setAskTerminal] = useState(false);
  const [noTerminal, setNoTerminal] = useState(false);
  const uid = useId();
  const root = useRef<HTMLDivElement>(null);
  /** The question whose own-answer field takes the focus when `Your own answer` is picked. */
  const focusOwn = useRef<string | null>(null);

  const p: GatePicks = useMemo(() => ({ picks, own }), [picks, own]);
  const changed = changedCount(move, p);
  const open = unanswered(move, p);
  const why = move.stale ? 'The spec or plan changed since this was shown. Read the new version, then decide.'
    : held ? 'Another place is working on this job. Only one place can work on a job at a time.'
      : open !== null ? `Question ${open} has no answer. Pick one, or write your own.` : null;
  const label = move.questions.length === 0 ? `Go · ${move.goSays}` : changed ? `Go · ${changed} changed` : 'Go · all recommended';
  const confirms = move.openDecisions.length;
  const hint = `Go: ${move.goSays}.${move.questions.length ? ' Sends your answers' : ' Sends your go-ahead'}${confirms ? ` and confirms the ${confirms} open decision${confirms === 1 ? '' : 's'}` : ''}; words in the message box go with it as a note.`;

  const pick = (q: string, option: string) => {
    store.forGate(key);
    store.setPick(q, option);
    setLine(null);
  };
  const setOwn = (q: string, words: string) => {
    store.forGate(key);
    store.setOwn(q, words);
  };

  const goNow = useCallback(async (extra: { startAfterReset?: boolean } = {}) => {
    // Once: a second click, ⌘↵ or a while it is out finds it here and does nothing.
    const was = goSent.get(slug);
    if (was && was.key === key && !over) return;
    const ui = store.getState().ui;
    const now: GatePicks = ui.picksFor === key ? { picks: ui.picks, own: ui.own } : { picks: {}, own: {} };
    if (move.stale || held || unanswered(move, now) !== null) return;
    const note = ui.draft;
    const body = gateBody('approve', move, now, { confirmNoTerminal: noTerminal, note, startAfterReset: extra.startAfterReset });
    setGo(slug, { key, phase: 'sending', line: '', runId: null });
    setLine(null);
    const carried = typeof body.note === 'string';
    if (carried) store.setDraft('');
    /** Not sent: the card again with his picks, and his words back in the box (before anything typed since). */
    const giveBack = (words: string) => {
      setGo(slug, null);
      setLine(words);
      if (!carried) return;
      const draft = store.getState().ui.draft;
      if (!draft.trim()) store.setDraft(note);
      else if (!draft.includes(note)) store.setDraft(`${note}\n\n${draft}`);
    };
    let r: GateResult;
    try {
      r = await sendGate(api, slug, body);
    } catch (err) {
      giveBack(refusalWords(err));
      if (err instanceof ApiError && err.body.code === 'terminal-open') setAskTerminal(true);
      if (err instanceof ApiError && (err.body.code === 'stale-gate' || err.body.code === 'stale-brief')) void store.loadPage();
      return;
    }
    const queued = (r as { queued?: { id?: unknown } } | null)?.queued;
    if (r?.sent) setGo(slug, { key, phase: 'sent', line: '', runId: typeof r.run?.id === 'string' ? r.run.id : null });
    else if (r?.held) setGo(slug, { key, phase: 'held', line: r.message ?? 'Held until Claude’s usage limit resets.', runId: null });
    else if (queued && typeof queued === 'object') setGo(slug, { key, phase: 'queued', line: '', runId: null });
    else giveBack(r?.message ?? 'Nothing was sent.');
  }, [api, store, slug, key, move, held, noTerminal, over]);

  const options = () => [...(root.current?.querySelectorAll<HTMLInputElement>('input[data-jp-opt]') ?? [])];
  const moveBy = (by: 1 | -1, e: KeyboardEvent) => {
    // The reader keeps its own arrows (it scrolls).
    if (e.target instanceof Element && e.target.closest('.jp2-reader')) return false;
    const all = options();
    if (!all.length) return false;
    const at = all.indexOf(document.activeElement as HTMLInputElement);
    const next = at < 0 ? (by > 0 ? 0 : all.length - 1) : Math.max(0, Math.min(all.length - 1, at + by));
    all[next].focus();
    return true;
  };

  useKeyScope('jobpage', {
    'jp-go': () => { if (why) return false; void goNow(); },
    'jp-yes': () => { if (why) return false; void goNow(); },
    'jp-opt-next': (e) => moveBy(1, e),
    'jp-opt-prev': (e) => moveBy(-1, e),
    'jp-opt-pick': () => {
      const at = document.activeElement;
      if (!(at instanceof HTMLInputElement) || !options().includes(at)) return false;
      at.click();
    },
  }, !sent);

  const label0 = moveLabel(false, move.since);
  if (sent) {
    const words = sent.phase === 'held' ? sent.line
      : sent.phase === 'queued' ? 'Queued for your laptop: it goes to the Foreman when the laptop picks it up.'
        : move.questions.length ? 'Sent · the Foreman is reading your answers' : 'Sent · the Foreman is reading your go-ahead';
    return <p className="jp2-ym-sent" role="status">{words}</p>;
  }
  return (
    <Card label={label0} ask={move.ask}>
      <div ref={root} className="jp2-ym-qs">
        {move.questions.map((q, i) => {
          const chosen = pickOf(q, p);
          const name = `${uid}-q${q.id}`;
          const ownOpen = q.options.length === 0 || chosen === OWN;
          return (
            <fieldset key={q.id} className="jp2-ym-q">
              <legend className="jp2-ym-qt">{i + 1}. {q.text}</legend>
              {q.options.map((o) => (
                <OptionRow
                  key={o.id}
                  type="radio"
                  name={name}
                  value={o.id}
                  className="jp2-ym-opt"
                  data-jp-opt=""
                  data-q={q.id}
                  checked={chosen === o.id}
                  onChange={() => pick(q.id, o.id)}
                  title={o.recommended ? 'The Foreman recommends this; it is picked for you. Pick another to change it.' : 'Answer with this option.'}
                >
                  <span className="jp2-ym-ot">
                    <span className="jp2-ym-ol"><b>{o.id}.</b> {o.label}</span>
                    {o.recommended && <span className="jp2-ym-rec">recommended</span>}
                    {o.consequence && <small>{o.consequence}</small>}
                  </span>
                </OptionRow>
              ))}
              {q.options.length > 0 && (
                <OptionRow
                  type="radio"
                  name={name}
                  value={OWN}
                  className="jp2-ym-opt jp2-ym-ownrow"
                  data-jp-opt=""
                  data-q={q.id}
                  checked={chosen === OWN}
                  onChange={() => { focusOwn.current = q.id; pick(q.id, OWN); }}
                  title="Answer in your own words instead."
                >
                  <span className="jp2-ym-ot">Your own answer</span>
                </OptionRow>
              )}
              {ownOpen && (
                <input
                  type="text"
                  className="text-input jp2-ym-ownin"
                  aria-label={q.options.length > 0 ? `Your own answer to question ${i + 1}` : `Your answer to question ${i + 1}`}
                  placeholder={q.options.length > 0 ? 'Your own answer' : 'Your answer'}
                  value={own[q.id] ?? ''}
                  onChange={(e) => setOwn(q.id, e.target.value)}
                  ref={(el) => { if (el && focusOwn.current === q.id) { focusOwn.current = null; el.focus(); } }}
                  title="Your answer in your own words."
                />
              )}
            </fieldset>
          );
        })}
      </div>
      {move.decided > 0 && (
        <p className="jp2-ym-dec">
          {move.decided} decided for you · confirmed by Go
          <Button kind="quiet" size={size} className="jp2-ym-look" onClick={(e) => { if (onOpen) onOpen(DECISIONS, e.currentTarget); else { store.setReader(DECISIONS); replaceHash(readHref(slug, DECISIONS)); } }} title="Open what was decided for you in the reader.">Look</Button>
        </p>
      )}
      {askTerminal && (
        <label className="check jp2-ym-check" title="Claude Code is open in this repository in a terminal. Two Foremen on one job would trip over each other.">
          <Choice type="checkbox" checked={noTerminal} onChange={(e) => setNoTerminal(e.target.checked)} /> None of the open terminals is this job’s Foreman
        </label>
      )}
      <div className="jp2-ym-calls">
        <Button kind="primary" size={size} keyId="jp-go" keyShown disabled={why !== null} onClick={() => void goNow()} title={why ? `Off: ${why}` : hint}>{label}</Button>
        {limited && (
          <Button kind="quiet" size={size} disabled={why !== null} onClick={() => void goNow({ startAfterReset: true })} title="Claude’s usage limit is reached: your Go waits, and goes to the Foreman when it resets.">Go after the reset</Button>
        )}
      </div>
      {(line ?? why) && <p className={`jp2-ym-why${line ? ' is-problem' : ''}`} role={line ? 'alert' : 'status'}>{line ?? why}</p>}
    </Card>
  );
}

// ---------- A free-text ask ----------

function AskCard({ move }: { move: QuestionMove }) {
  const size = useCallSize();
  const store = useJobStore();
  const fill = (reply: string) => {
    const draft = store.getState().ui.draft;
    // A quick reply replaces another; his own words stay, with the reply under them.
    const text = !draft.trim() || move.quick.includes(draft.trim()) ? reply : `${draft.replace(/\s+$/, '')}\n${reply}`;
    store.setDraft(text);
    pressKey('jp-write');
    requestAnimationFrame(() => {
      const box = document.activeElement;
      if (box instanceof HTMLTextAreaElement) box.setSelectionRange(box.value.length, box.value.length);
    });
  };
  return (
    <Card label={moveLabel(false, move.since)} ask={move.ask}>
      {move.quick.length > 0 && (
        <div className="jp2-ym-quick" role="group" aria-label="Quick replies">
          {move.quick.map((q) => (
            <Button key={q} size={size} className="jp2-ym-reply" onClick={() => fill(q)} title="Put this reply in the message box. Nothing is sent until you press Send.">“{q}”</Button>
          ))}
        </div>
      )}
    </Card>
  );
}

// ---------- A permission, or a crew question ----------

type Answer = { decision: 'allow' | 'allow-run' | 'deny'; answers?: Record<string, string> };

function PermissionCard({ move }: { move: PermissionMove }) {
  const size = useCallSize();
  const { api, store: app } = useWorkshop();
  const [done, setDone] = useState<string | null>(null);
  const [line, setLine] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Permission | null>(null);
  const out = useRef(false);
  const alwaysBtn = useRef<HTMLButtonElement>(null);
  const keyOk = move.card !== 'question' && !move.hardLine && !move.defaultToNo && move.risk !== 'high';
  const always = move.canAlwaysAllow && !move.hardLine && !move.defaultToNo;

  async function answer(body: Answer, words: string) {
    if (out.current) return;
    out.current = true;
    setDone(words);
    setLine(null);
    let r: { queued?: unknown } | null;
    try {
      r = await api.post<{ queued?: unknown }>(`/api/permissions/${encodeURIComponent(move.id)}`, body);
    } catch (err) {
      out.current = false;
      setDone(null);
      setLine(err instanceof TypeError ? UNREACHABLE : err instanceof Error ? err.message : String(err));
      return;
    }
    // On the website the answer waits for the laptop.
    if (r && typeof r === 'object' && r.queued) { setDone('Queued for your laptop: it goes when the laptop picks it up.'); return; }
    app.dispatch({ type: 'permission-answered', id: move.id });
  }

  useKeyScope('jobpage', {
    // A hard line or a risky step: a does nothing at all.
    'jp-yes': () => { if (keyOk) void answer({ decision: 'allow' }, 'Allowed once'); },
  }, done === null && sheet === null);

  const openSheet = () => {
    const full = app.getState().permissions.find((x) => x.id === move.id) ?? null;
    if (full?.draft?.options?.length) setSheet(full);
    else setLine('This request’s rule isn’t on this page. Use Allow once, or save a rule from the old job page.');
  };

  if (done) return <p className="jp2-ym-sent" role="status">{done}</p>;
  if (move.card === 'question') return <CrewQuestion move={move} line={line} onAnswer={answer} />;
  return (
    <Card label={moveLabel(true, move.since)} ask={move.what}>
      {move.command && <pre className="jp2-ym-cmd">{move.command}</pre>}
      {move.hardLine && <p className="jp2-ym-why">A hard line: a key never allows it.</p>}
      <div className="jp2-ym-calls">
        <Button kind="primary" size={size} keyId={keyOk ? 'jp-yes' : undefined} keyShown onClick={() => void answer({ decision: 'allow' }, 'Allowed once')} title="Let it do exactly this, one time. It asks again next time.">Allow once</Button>
        {move.canAllowForRun && !move.hardLine && (
          <Button kind="quiet" size={size} onClick={() => void answer({ decision: 'allow-run' }, 'Allowed for this run')} title="Let it do this kind of step without asking again until this reply is finished. Nothing is saved.">Allow for this run</Button>
        )}
        <Button size={size} onClick={() => void answer({ decision: 'deny' }, 'Denied · the Foreman was told no')} title="Say no. It skips this and carries on.">Deny</Button>
        {always && (
          <Button ref={alwaysBtn} kind="quiet" size={size} onClick={openSheet} title="Save a rule so steps like this run without asking, in every job. You choose how narrow it is and confirm it first; remove it any time in Settings.">Always allow…</Button>
        )}
      </div>
      {line && <p className="jp2-ym-why is-problem" role="alert">{line}</p>}
      {sheet?.draft && <AlwaysAllowSheet permission={sheet} draft={sheet.draft} onClose={() => { setSheet(null); alwaysBtn.current?.focus(); }} />}
    </Card>
  );
}

function CrewQuestion({ move, line, onAnswer }: { move: PermissionMove; line: string | null; onAnswer(body: Answer, words: string): void }) {
  const size = useCallSize();
  const qs = move.questions ?? [];
  const uid = useId();
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [words, setWords] = useState<Record<number, string>>({});
  const answerOf = (i: number) => (picked[i] === OWN ? (words[i] ?? '').trim() : picked[i] ?? '');
  const ready = qs.length > 0 && qs.every((_, i) => answerOf(i) !== '');
  return (
    <Card label={moveLabel(true, move.since)} ask={move.what}>
      {qs.map((q, i) => (
        <fieldset key={i} className="jp2-ym-q">
          <legend className="jp2-ym-qt">{q.question}</legend>
          {q.options.map((o) => (
            <OptionRow key={o.label} type="radio" name={`${uid}-${i}`} className="jp2-ym-opt" checked={picked[i] === o.label} onChange={() => setPicked((x) => ({ ...x, [i]: o.label }))} title="Pick this answer.">
              <span className="jp2-ym-ot">{o.label}</span>
            </OptionRow>
          ))}
          <OptionRow type="radio" name={`${uid}-${i}`} className="jp2-ym-opt jp2-ym-ownrow" checked={picked[i] === OWN} onChange={() => setPicked((x) => ({ ...x, [i]: OWN }))} title="None of these fits: answer in your own words.">
            <span className="jp2-ym-ot">Your own answer</span>
          </OptionRow>
          {picked[i] === OWN && (
            <input type="text" className="text-input jp2-ym-ownin" aria-label={`Your own answer to: ${q.question}`} placeholder="Your own answer" value={words[i] ?? ''} onChange={(e) => setWords((x) => ({ ...x, [i]: e.target.value }))} />
          )}
        </fieldset>
      ))}
      {qs.length === 0 && <p className="jp2-ym-why">The question didn’t come through. You can say no, and the Foreman will ask again in its reply.</p>}
      <div className="jp2-ym-calls">
        <Button kind="primary" size={size} disabled={!ready} onClick={() => onAnswer({ decision: 'allow', answers: Object.fromEntries(qs.map((q, i) => [q.question, answerOf(i)])) }, 'Answers sent')} title={ready ? 'Send your answers to the Foreman.' : 'Answer every question first.'}>Send answers</Button>
        <Button kind="quiet" size={size} onClick={() => onAnswer({ decision: 'deny' }, 'Not answered · the Foreman carries on without your choice')} title="Don’t answer. The Foreman carries on without your choice.">Don’t answer</Button>
      </div>
      {line && <p className="jp2-ym-why is-problem" role="alert">{line}</p>}
    </Card>
  );
}
