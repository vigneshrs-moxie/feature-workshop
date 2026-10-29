// The gate card (design doc section 3, lighter in plan §4): pinned above the composer while the
// Foreman waits for your decision on a brief. It shows the brief's questions (the recommendation
// picked), one primary button, Approve (key a), with Edit then approve, Revise and Other guidance
// as plain links on one line; "Adjust the next step" (key .), a disclosure holding the chips that
// change how the next stage runs and the exact lines they add; the decisions made on your behalf
// folded to one line (key v opens them; each one can be overridden); and, while Approve is off, a
// visible list of why (an open question, an override with nothing said, a changed plan) that
// empties as you resolve them. Everything goes in one reply through POST /api/job/:slug/gate:
// the dashboard composes it (composeReply, the same words the card previews), saves the chips'
// option changes, and sends it; or, while the Foreman is still working, gives the text back, which
// waits in the composer with the brief it answers. Nothing is ever approved automatically.
//
// GateSlot holds what outlives one card: the line saying what happened (the card itself goes once
// the brief is answered, or changes when the Foreman moves on to a new brief).
import { useEffect, useId, useRef, useState } from 'react';
import { ApiError } from '../../api/client';
import type { Gate, GateRequest, GateResult, Job, JobDetail, JobLockInfo } from '../../api/types';
import { loadJobDoc, sendGate, stopRun } from '../../app/jobActions';
import { useKeyScope } from '../../app/keyRegistry';
import { navigate } from '../../app/router';
import { useUi } from '../../app/ui';
import { reviewable, screensFromJson, screenWord, useFrameMounted, useWireframes, type WireframeScreen } from '../Preview/wireframes';
import { HowThisWorks } from '../../components/HowThisWorks';
import { InlineText } from '../../components/InlineText';
import { Kbd } from '../../components/Kbd';
import { composeGate, type GateKind } from '../../lib/compose';
import {
  answersFor, approveLabel, chipsFor, chipViews, decidedKey, emptyOverride, gateDraftKey, gateRequest, initialChoices,
  oneKeyGateApprove, openDecisions, openGate, OTHER, placeGateReply, readGateMemo, readReopenedMemo, reopenMemo, toggleChip, unansweredQuestion,
  verdictsFor, type ChipId, type GateChoices,
} from '../../lib/gateCard';
import { plainInline } from '../../lib/inlineMarkdown';
import { isLevel, levelChange, lensNames } from '../../lib/levels';
import { readStored, useStored, writeStored } from '../../lib/stored';
import { clockTime, fullTime, relativeTime } from '../../lib/time';
import { useWorkshop, useWorkshopState } from '../../state/store';
import { stageLabel } from '../Jobs/stages';
import { draftKey, SendPreview } from './Composer';
import { EVIDENCE_STAGES, EvidenceStrip } from './EvidenceStrip';
import { isActiveRun } from './thread';
import { LockCard, lockFromError, lockHeadline } from '../../views/JobLock/LockCard';

// Refusals that mean the card is out of date: the Foreman moved on to a new brief, or the spec or
// plan changed since the card was raised. The slot says so and the job is fetched again.
const STALE_CODES = ['stale-brief', 'stale-gate'];
const isStale = (err: unknown) => err instanceof ApiError && err.status === 409 && STALE_CODES.includes(String(err.body.code));

/** What the slot says after a decision: sent, held, waiting in the composer, or refused. */
export interface GateNotice {
  tone: 'ok' | 'problem';
  text: string;
  /** How the job runs from the next stage, when the chips changed its options. */
  lines?: string[];
  /** Where focus goes: the notice itself, or the composer (where the reply waits). */
  focus: 'notice' | 'composer';
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function waitedText(iso: string | null, now: Date): string {
  const rel = relativeTime(iso, now);
  if (!rel) return '';
  return /^\d/.test(rel) ? `waiting ${rel}` : `waiting since ${rel}`;
}

/** Focus the composer's text box (a reply waits there). */
function focusComposer() {
  document.querySelector<HTMLTextAreaElement>('[data-composer-input]')?.focus();
}

/** Open the job header's level chip, so you can pick a level. */
function openLevelChip() {
  const chip = document.querySelector<HTMLButtonElement>('.level-chip');
  if (!chip) return;
  chip.focus();
  if (chip.getAttribute('aria-expanded') !== 'true') chip.click();
}

/**
 * The screens stage's card: one row of the page's sections (the screens and the design choices),
 * each a jump to that section in the Screens tab, with what you marked there in a word once the page
 * has reported ("Needs change", "Pick A"); before the Screens tab has loaded the page, the same list
 * from wireframes.json (the skill writes it next to the page). "Review the screens" opens the tab.
 * Where no Screens tab shows this job (the Desk), the chips open the full-width screens page.
 */
function ScreensRow({ slug, hasPage }: { slug: string; hasPage: boolean }) {
  const { api } = useWorkshop();
  const ui = useUi();
  const report = useWireframes(slug);
  const mounted = useFrameMounted(slug);
  const [fromJson, setFromJson] = useState<WireframeScreen[] | null>(null);
  useEffect(() => {
    if (report || !hasPage) return;
    let cancelled = false;
    loadJobDoc(api, slug, 'wireframes.json').then(
      (doc) => { if (!cancelled) setFromJson(screensFromJson(doc?.text ?? '')); },
      () => { if (!cancelled) setFromJson([]); },
    );
    return () => { cancelled = true; };
  }, [api, slug, hasPage, report !== null]);
  const screens = reviewable(report?.screens ?? fromJson ?? []);
  const open = (key?: string) => {
    ui.openScreens(slug, key);
    if (!mounted) navigate({ name: 'screens', slug });
  };
  if (!hasPage) return null;
  return (
    <div className="gate-screens" role="group" aria-label="The screens">
      <span className="muted gate-screens-label">Screens{report?.version ? ` v${report.version}` : ''}:</span>
      {screens.map((s) => {
        const word = screenWord(s);
        return (
          <button key={s.key} type="button" className="btn gate-screen" onClick={() => open(s.key)} title={`${s.kind === 'choice' ? 'Design choice' : 'Screen'}: ${s.name}. Open the Screens tab at this section${word ? ` (you marked it: ${word})` : ''}.`}>
            {s.name}{word && <span className="gate-screen-word">· {word}</span>}
          </button>
        );
      })}
      <button type="button" className="link-button" onClick={() => open()} title="Open the Screens tab: review each screen on the page, pick the design choices, and Copy feedback puts your notes in your reply.">Review the screens</button>
    </div>
  );
}

/** `callsOutside`: the page draws its own big calls (the Desk's Go / No go / Reply) and presses the card's buttons, so the card's row is hidden. */
export function GateSlot({ job, detail, now, reload, callsOutside = false }: { job: Job; detail: JobDetail; now: Date; reload(): void; callsOutside?: boolean }) {
  const { runs } = useWorkshopState();
  const [notice, setNotice] = useState<GateNotice | null>(null);
  const [memoRaw, setMemo] = useStored(gateDraftKey(job.slug));
  const [draft] = useStored(draftKey(job.slug));
  const memo = draft?.trim() ? readGateMemo(memoRaw) : null;
  const gate = openGate(detail, Boolean(job.closed));
  // The live run first (it ends before the job is fetched again), else the detail's.
  const running = isActiveRun(runs[job.slug] ?? detail.run ?? null);
  const noticeEl = useRef<HTMLDivElement>(null);
  const headId = useId();

  useEffect(() => {
    if (!notice) return;
    if (notice.focus === 'composer') focusComposer();
    else noticeEl.current?.focus();
  }, [notice]);

  // Your reply to this brief waits in the composer (made while the Foreman was working).
  const waiting = gate !== null && memo !== null && gate.briefNumber !== null && memo.brief === gate.briefNumber;

  return (
    <>
      {notice && (
        <div ref={noticeEl} className={`gate-notice is-${notice.tone}`} role={notice.tone === 'problem' ? 'alert' : 'status'} tabIndex={-1}>
          <p className="gate-notice-text">{notice.text}</p>
          {notice.lines && notice.lines.length > 0 && (
            <ul className="gate-notice-lines" aria-label="How the job runs from the next stage">
              {notice.lines.map((l) => <li key={l}>{l}</li>)}
            </ul>
          )}
          <button type="button" className="btn btn-quiet" onClick={() => setNotice(null)} title="Close this note.">Got it</button>
        </div>
      )}
      {gate && (waiting ? (
        <section className="perm-card question-card gate-card gate-held" data-ask="question" aria-labelledby={headId}>
          <h3 className="perm-headline" id={headId}>Brief {gate.briefNumber}: your reply is in the message box</h3>
          <p className="muted" role="status">
            {running
              ? 'Send it once the Foreman finishes the reply in progress. Until it goes, this brief stays open.'
              : 'The Foreman has finished; send your reply from the message box. Until it goes, this brief stays open.'}
          </p>
          <div className="perm-actions">
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => { if (memo) setMemo(reopenMemo(memo)); }}
              title="Decide on this brief again here. Your new decision replaces the one in the message box if you haven’t changed it; otherwise it is added after it, and the card says so."
            >
              Decide again here
            </button>
          </div>
        </section>
      ) : (
        <GateCard key={`${job.slug}#${gate.briefNumber ?? '-'}`} job={job} detail={detail} gate={gate} now={now} reload={reload} report={setNotice} running={running} callsOutside={callsOutside} />
      ))}
    </>
  );
}

type Mode = null | 'changes' | 'message' | 'stop';

function GateCard({ job, detail, gate, now, reload, report, running, callsOutside = false }: {
  job: Job; detail: JobDetail; gate: Gate; now: Date; reload(): void; report(n: GateNotice): void; callsOutside?: boolean;
  /** The Foreman is working on a reply for this job right now. */
  running: boolean;
}) {
  const { api } = useWorkshop();
  const { meta, usage, runs } = useWorkshopState();
  const slug = job.slug;
  const uid = useId();
  const headId = `${uid}-head`;
  const [c, setC] = useState<GateChoices>(() => initialChoices(gate));
  const [mode, setMode] = useState<Mode>(null);
  const [note, setNote] = useState('');
  const [stopName, setStopName] = useState('');
  const [stopNote, setStopNote] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const tryUi = useUi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askTerminal, setAskTerminal] = useState(false);
  const [noTerminal, setNoTerminal] = useState(false);
  // The job is held elsewhere (a terminal, another dashboard): from the snapshot, or a refused answer.
  const [refused, setRefused] = useState<JobLockInfo | null>(null);
  const heldAt = job.lock ?? null;
  useEffect(() => { setRefused(null); }, [heldAt?.pid, heldAt?.acquiredAt]);
  const lock = heldAt ?? refused;
  const [editing, setEditing] = useState<string | null>(null);
  const edited = useRef<GateResult | null>(null);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const editBtn = useRef<HTMLButtonElement>(null);
  const menuBox = useRef<HTMLDivElement>(null);
  const noteBox = useRef<HTMLTextAreaElement>(null);
  const stopBox = useRef<HTMLInputElement>(null);

  const levels = meta?.levels;
  const level = isLevel(gate.level) ? gate.level : isLevel(job.level) ? job.level : null;
  const fableChecks = Array.isArray(detail.options?.fable_checks) ? detail.options.fable_checks : [];
  const views = chipViews(gate, { level, fableChecks });
  const chips = chipsFor(views, c.chips);
  const chipLines = chips.length ? composeGate({ kind: 'message', chips }).split('\n').filter(Boolean) : [];
  const levelChip = chips.find((x) => x.kind === 'level');
  const consequence = levelChip && levelChip.kind === 'level' ? levelChange(level, levelChip.level, levels, lensNames(meta), gate.stage ?? job.stage ?? null).text : null;
  const decided = openDecisions(gate);
  const stale = gate.stale;
  const limited = Boolean(usage?.limited);
  const next = gate.nextStage ? stageLabel(gate.nextStage) : null;
  const stage = stageLabel(gate.stage);
  // Only chips that apply to this next stage name anything (a pressed one that no longer applies is left out).
  const chosen = c.chips.filter((id) => views.some((v) => v.id === id && v.enabled));
  const approve = approveLabel(gate, chosen);
  // Why Approve is off, in plain words (the Kingdom Inspection pattern): the list empties as you resolve them.
  const offReasons: string[] = [];
  if (stale) offReasons.push('The plan changed since this card was raised, so this approval would be for an old version. Ask for changes, or wait for the new brief.');
  const missingOverride = emptyOverride(gate, c);
  if (missingOverride) offReasons.push(`Say what “${missingOverride.decision}” should be instead, or undo that override.`);
  const openQuestion = unansweredQuestion(gate, c);
  if (openQuestion !== null) offReasons.push(`Question ${openQuestion} has no answer. Pick one, or write your own.`);
  if (lock) offReasons.push(`${lockHeadline(lock, now)}. Only one place can work on a job at a time.`);
  const approveOff = offReasons.length > 0;
  // The two disclosures, remembered in this browser (closed until you open them).
  const [adjustRaw, setAdjustRaw] = useStored('fw.gate.adjust');
  const adjustOpen = adjustRaw === 'open';
  const setAdjustOpen = (on: boolean) => setAdjustRaw(on ? 'open' : 'closed');
  const [decidedRaw, setDecidedRaw] = useStored('fw.gate.decided');
  const decidedOpen = decidedRaw === 'open';
  const setDecidedOpen = (on: boolean) => setDecidedRaw(on ? 'open' : 'closed');

  // The ⋯ menu: closes on Escape (focus back on ⋯) or a click elsewhere.
  useEffect(() => {
    if (!menuOpen) return;
    menuBox.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const onDown = (e: MouseEvent) => { if (!menuBox.current?.contains(e.target as Node)) setMenuOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setMenuOpen(false); moreBtn.current?.focus(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [menuOpen]);

  useEffect(() => {
    if (mode === 'stop') stopBox.current?.focus();
    else if (mode) noteBox.current?.focus();
  }, [mode]);

  const update = (fn: (prev: GateChoices) => GateChoices) => setC((prev) => fn(prev));
  const setChoice = (q: string, v: string) => update((p) => ({ ...p, choices: { ...p.choices, [q]: v } }));
  const setOther = (q: string, v: string, pick: boolean) => update((p) => ({ ...p, others: { ...p.others, [q]: v }, choices: pick ? { ...p.choices, [q]: OTHER } : p.choices }));
  const override = (key: string) => update((p) => ({ ...p, overrides: { ...p.overrides, [key]: '' } }));
  const setOverride = (key: string, v: string) => update((p) => ({ ...p, overrides: { ...p.overrides, [key]: v } }));
  const undoOverride = (key: string) => update((p) => { const o = { ...p.overrides }; delete o[key]; return { ...p, overrides: o }; });
  const toggle = (id: ChipId) => update((p) => ({ ...p, chips: toggleChip(p.chips, id) }));

  /**
   * What stops a decision before it is sent: an override with nothing said (any decision but a
   * stop), or, for an approval, a question with no answer.
   */
  function problemWith(kind: GateKind): string | null {
    if (kind === 'stop') return null;
    const missing = emptyOverride(gate, c);
    if (missing) return `Say what “${missing.decision}” should be instead, or undo that override.`;
    const q = kind === 'approve' ? unansweredQuestion(gate, c) : null;
    return q === null ? null : `Question ${q} has no answer. Pick one, or write your own, before approving.`;
  }

  /** Send one decision; a refusal throws (a stale brief or gate also refetches the job and says so). */
  async function post(kind: GateKind, extra: Partial<GateRequest> = {}): Promise<GateResult> {
    const problem = problemWith(kind);
    if (problem) throw new Error(problem);
    const body = gateRequest(kind, gate, c, views, { ...(noTerminal ? { confirmNoTerminal: true } : {}), ...extra });
    try {
      return await sendGate(api, slug, body);
    } catch (err) {
      const held = lockFromError(err);
      if (held) setRefused(held);
      if (isStale(err)) {
        setEditing(null);
        reload();
        report({ tone: 'problem', text: (err as Error).message, focus: 'notice' });
      }
      throw err;
    }
  }

  /** What happened, said in the slot; a reply given back (the Foreman is working) waits in the composer. */
  function done(kind: GateKind, r: GateResult) {
    const dropped = r.chipsDropped ? ` ${r.chipsDropped} option ${plural(r.chipsDropped, 'change didn’t', 'changes didn’t')} apply and ${plural(r.chipsDropped, 'was', 'were')} left out.` : '';
    const lines = r.summary?.length ? r.summary : undefined;
    if (r.sent) {
      const what = kind === 'stop' ? 'Stop sent: the Foreman records where things stand and starts nothing else.'
        : kind === 'approve' ? 'Your approval went to the Foreman.'
          : kind === 'changes' ? 'The changes you asked for went to the Foreman. It stays in this stage and revises.'
            : 'Your guidance went to the Foreman.';
      report({ tone: 'ok', text: `${what}${dropped}`, lines, focus: 'notice' });
    } else if (r.held) {
      report({ tone: 'ok', text: `${r.message ?? 'Held until Claude’s usage limit resets.'}${dropped}`, lines, focus: 'notice' });
    } else {
      // The Foreman is still working: the reply waits in the composer, remembering its brief and
      // its text. Decided again ("Decide again here"), it replaces the earlier decision when that is
      // unchanged; anything else already in the box stays, and the note says so.
      const memoRaw = readStored(gateDraftKey(slug));
      const earlier = readReopenedMemo(memoRaw) ?? readGateMemo(memoRaw);
      const placed = placeGateReply(readStored(draftKey(slug)) ?? '', r.text, earlier && earlier.brief === gate.briefNumber ? earlier : null);
      writeStored(draftKey(slug), placed.text);
      if (gate.briefNumber) writeStored(gateDraftKey(slug), JSON.stringify({ brief: gate.briefNumber, kind, text: r.text }));
      const where = placed.replaced && !placed.kept ? ' It replaces your earlier reply to this brief.'
        : placed.replaced ? ' It replaces your earlier reply to this brief; the text you had above it is kept.'
          : placed.kept ? ' What was already in the box is still there, above it: delete what you don’t want before sending, or both go.'
            : '';
      report({
        tone: 'ok',
        text: `The Foreman is still working; your reply is ready to send when it finishes. It’s in the message box below.${where}${r.options ? ' The option changes are saved already.' : ''}${dropped}`,
        lines, focus: 'composer',
      });
    }
    reload();
  }

  async function act(kind: GateKind, extra: Partial<GateRequest> = {}) {
    setBusy(true);
    setError(null);
    try {
      done(kind, await post(kind, extra));
    } catch (err) {
      if (isStale(err)) return; // said in the slot; the card is refetched
      if (err instanceof ApiError && err.body.code === 'terminal-open') setAskTerminal(true);
      setError(err instanceof ApiError && err.body.code === 'terminal'
        ? 'This job’s Foreman was last used in your terminal. Carry on there, or close it in the terminal and try again here.'
        : message(err));
    } finally {
      setBusy(false);
    }
  }

  function openEdit() {
    const problem = problemWith('approve');
    if (problem) { setError(problem); return; }
    setError(null);
    setEditing(composeGate({ kind: 'approve', answers: answersFor(gate, c), verdicts: verdictsFor(gate, c, 'approve'), chips }, detail.statusForCompose));
  }

  /** The "Edit, then approve" sheet closed without sending: focus goes back to its button. */
  function closeEdit() {
    setEditing(null);
    editBtn.current?.focus();
  }

  /**
   * Stop the job. While the Foreman is working on a reply, that reply is ended first (as the
   * composer's Stop does); the stop then waits in the message box until it has ended, as any
   * decision made while it works does.
   */
  async function stopJob() {
    const run = runs[slug] ?? detail.run ?? null;
    if (running && isActiveRun(run) && run.status !== 'stopping') {
      setBusy(true);
      setError(null);
      try { await stopRun(api, run.id); } catch (err) { setBusy(false); setError(message(err)); return; }
    }
    await act('stop', { note: stopNote });
  }

  function openMode(m: Mode) {
    setError(null);
    setMenuOpen(false);
    setMode((now) => (now === m ? null : m));
  }

  // The card's keys (the 'gate' scope): off while a decision is being sent. `a` only where the Desk
  // would allow one key too; 1–3 answer the first question still open.
  useKeyScope('gate', {
    'gate-approve': () => { if (!oneKeyGateApprove(gate, job.waitingFor)) return false; void act('approve'); },
    'gate-edit': () => { if (stale) return false; openEdit(); },
    'gate-revise': () => openMode('changes'),
    'gate-guidance': () => openMode('message'),
    'gate-answer': (e) => {
      const n = unansweredQuestion(gate, c);
      const q = n === null ? null : gate.questions[n - 1];
      const o = q?.options[Number(e.key) - 1];
      if (!q || !o) return false;
      setChoice(q.id, o.id);
    },
    'gate-adjust': () => setAdjustOpen(!adjustOpen),
    'gate-decided': () => { if (!decided.length) return false; setDecidedOpen(!decidedOpen); },
  }, !busy);

  const resetAt = usage?.resetsAt ? clockTime(usage.resetsAt, now) : '';
  const waited = waitedText(gate.waitingSince, now);
  const approveHint = `${approve}. Sends your answers, confirms the decisions you didn’t override, adds the chips’ lines, and says “At these versions”.${gate.nextProposed ? ` The Foreman goes ahead with: ${plainInline(gate.nextProposed)}.` : ''}`;
  const staleHint = 'Off: the plan changed since this card was raised, so this approval would be for an old version.';

  return (
    <section className={`perm-card question-card gate-card${stale ? ' is-stale' : ''}`} data-ask="question" aria-labelledby={headId} aria-busy={busy}>
      <header className="gate-head">
        <p className="perm-who gate-meta">
          <span className="ask-label" title={gate.stage ? `The Foreman finished ${stage} and waits for you before going on.` : 'The Foreman waits for you.'}>
            {gate.briefNumber ? `Brief ${gate.briefNumber}` : 'Brief'}{stage ? ` · ${stage}` : ''}
          </span>
          {waited && gate.waitingSince && <time className="thread-time" dateTime={gate.waitingSince} title={`Waiting for you since ${fullTime(gate.waitingSince)}.`}>{waited}</time>}
          {gate.parked && (
            <span className="chip gate-parked" title="This decision has waited for you for more than 4 hours. Nothing goes ahead until you decide; nothing is approved for you.">
              parked 4h
            </span>
          )}
        </p>
        <h3 className="perm-headline" id={headId}>{gate.headline ? <InlineText text={gate.headline} /> : 'The Foreman waits for your decision'}</h3>
        {gate.nextProposed && <p className="muted gate-next" title="What the Foreman proposes to do once you approve.">Next, as proposed: <InlineText text={gate.nextProposed} /></p>}
        {gate.proof && <ProofStamp proof={gate.proof} />}
        {gate.usage && <p className="perm-warn gate-usage" title="Claude’s usage limit, for a next stage that uses a lot of it.">{gate.usage}</p>}
        {stale && (
          <p className="perm-warn gate-stale-note" role="status">
            Plan changed since this was proposed. Approve is off; ask for changes or wait for the new brief.{' '}
            <button type="button" className="link-button" onClick={reload} title="Fetch this job again. Once the Foreman briefs you on the new version, a fresh card replaces this one.">Check again</button>
          </p>
        )}
        {gate.runActive && (
          <p className="muted gate-running" role="status">The Foreman is still working on a reply. Whatever you decide waits in the message box until it finishes.</p>
        )}
      </header>

      {lock && <LockCard lock={lock} now={now} />}
      {gate.stage === 'wireframe' && <ScreensRow slug={slug} hasPage={Boolean(job.wireframes)} />}
      {['implement', 'test', 'review'].includes(gate.stage ?? '') && (
        <p className="gate-try">
          <button type="button" className="link-button" onClick={() => tryUi.openTry(slug)} title="Open the Try it tab: start this job’s app on your computer and click around before you decide.">Try it on your computer</button>
        </p>
      )}
      {EVIDENCE_STAGES.includes(gate.stage ?? '') && <EvidenceStrip slug={slug} tested={gate.proof?.tested ?? null} refresh={detail} />}

      {gate.questions.map((q, i) => {
        const group = `${uid}-q${i}`;
        const otherId = `${group}-other`;
        return (
          <fieldset key={q.id} className="question gate-question" disabled={busy}>
            <legend>{i + 1}. <InlineText text={q.text} /></legend>
            {q.options.map((o) => (
              <label key={o.id} className="answer-option" title={o.id === q.recommendation ? 'The Foreman recommends this answer; it’s picked for you. Pick another to change it.' : 'Answer with this option.'}>
                <input type="radio" name={group} value={o.id} checked={c.choices[q.id] === o.id} onChange={() => setChoice(q.id, o.id)} />
                <span className="answer-label">
                  {o.id}) <InlineText text={o.label} />
                  {o.id === q.recommendation && <> <span className="chip gate-rec">Recommended</span></>}
                  {o.consequence && <span className="muted answer-consequence" title="What changes if you pick this answer."><InlineText text={o.consequence} /></span>}
                </span>
              </label>
            ))}
            <div className="answer-option answer-other">
              {q.options.length > 0 && (
                <label className="answer-other-pick" title="Answer in your own words instead.">
                  <input type="radio" name={group} value={OTHER} checked={c.choices[q.id] === OTHER} onChange={() => setChoice(q.id, OTHER)} />
                  <span className="answer-label">Other…</span>
                </label>
              )}
              <input
                id={otherId}
                className="text-input"
                aria-label={q.options.length > 0 ? `Your own answer to question ${i + 1}` : `Your answer to question ${i + 1}`}
                placeholder={q.options.length > 0 ? 'Your own answer' : 'Your answer'}
                value={c.others[q.id] ?? ''}
                onChange={(e) => setOther(q.id, e.target.value, q.options.length > 0)}
                title="Your answer in your own words. Typing here picks “Other…”."
              />
            </div>
          </fieldset>
        );
      })}

      {decided.length > 0 && (
        <details className="gate-decided" open={decidedOpen}>
          <summary className="gate-fold" onClick={(e) => { e.preventDefault(); setDecidedOpen(!decidedOpen); }} title="The decisions the Foreman made for you with this brief. Open them to read each one and override any of them; approving confirms the rest.">
            {decided.length === 1 ? '1 decision' : `${decided.length} decisions`} made for you · review <Kbd id="gate-decided" />
          </summary>
          <section className="gate-decided-body" aria-label="Decided on your behalf">
            <ul className="gate-decided-list">
              {decided.map((d) => {
                const key = decidedKey(d);
                const over = key in c.overrides;
                return (
                  <li key={key} className={`gate-decision${over ? ' is-changed' : ''}`}>
                    <p className="gate-decision-text">
                      {over && <><span className="chip gate-changed">Changed</span> </>}
                      <strong><InlineText text={d.decision} /></strong>
                      {d.reason && <span className="muted"> — <InlineText text={d.reason} /></span>}
                      {d.where && <span className="muted"> (<InlineText text={d.where} />)</span>}
                    </p>
                    {over ? (
                      <div className="gate-override">
                        <label className="field">
                          <span>What should it be instead?</span>
                          <textarea className="text-area" rows={2} value={c.overrides[key]} onChange={(e) => setOverride(key, e.target.value)} disabled={busy} title="Your decision instead. It goes in your reply as “changed”." />
                        </label>
                        <button type="button" className="link-button" onClick={() => undoOverride(key)} disabled={busy} title="Keep the Foreman’s decision after all: approving confirms it.">Undo override</button>
                      </div>
                    ) : (
                      <button type="button" className="link-button" onClick={() => override(key)} disabled={busy} title="Change this decision: say what it should be instead. Your reply then lists it as changed, not confirmed.">Override</button>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="muted gate-decided-note">Approving confirms the ones you don’t override.</p>
          </section>
        </details>
      )}

      {approveOff && (
        <div className="gate-off" role="status" aria-labelledby={`${uid}-off`}>
          <p className="gate-off-head" id={`${uid}-off`}>Approve is off:</p>
          <ul className="gate-off-list">
            {offReasons.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </div>
      )}
      <div className="perm-actions gate-actions" hidden={callsOutside}>
        <button type="button" className="btn btn-primary" data-gate="approve" disabled={busy || approveOff} onClick={() => void act('approve')} title={approveOff ? `Off: ${offReasons[0]}` : approveHint}>
          {approve}{oneKeyGateApprove(gate, job.waitingFor) && <Kbd id="gate-approve" />}
        </button>
        {limited && (
          <button
            type="button"
            className="btn"
            disabled={busy || approveOff}
            onClick={() => void act('approve', { startAfterReset: true })}
            title={approveOff ? `Off: ${offReasons[0]}` : `Approve now; the reply is held and goes to the Foreman when Claude’s usage limit resets${resetAt ? ` (around ${resetAt})` : ''}.`}
          >
            Approve, start after reset
          </button>
        )}
        <span className="gate-links">
          <button ref={editBtn} type="button" className="link-button" disabled={busy || stale || lock !== null} onClick={openEdit} title={stale ? staleHint : 'See the whole reply exactly as the Foreman will receive it, edit it, then send it as your approval.'}>
            Edit, then approve<Kbd id="gate-edit" />
          </button>
          <button type="button" className="link-button" data-gate="revise" disabled={busy || lock !== null} aria-expanded={mode === 'changes'} onClick={() => openMode('changes')} title="Ask for changes: the Foreman stays in this stage and revises. Nothing is approved.">
            Revise with feedback<Kbd id="gate-revise" />
          </button>
          <button type="button" className="link-button" data-gate="guidance" disabled={busy || lock !== null} aria-expanded={mode === 'message'} onClick={() => openMode('message')} title="Tell the Foreman something else: a question or guidance. Nothing is approved.">
            Other guidance<Kbd id="gate-guidance" />
          </button>
        </span>
        <div className="job-menu gate-more" ref={menuBox}>
          <button
            ref={moreBtn}
            type="button"
            className="btn btn-quiet"
            aria-label="More actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            disabled={busy}
            onClick={() => setMenuOpen((o) => !o)}
            title="More: stop this job."
          >
            ⋯
          </button>
          {menuOpen && (
            <ul className="job-menu-list gate-menu" role="menu" aria-label="More actions">
              <li role="none">
                <button type="button" role="menuitem" onClick={() => openMode('stop')} title="Stop the job here. You type its name to confirm.">
                  Stop job…
                </button>
              </li>
            </ul>
          )}
        </div>
      </div>

      {(mode === 'changes' || mode === 'message') && (
        <div className="gate-note">
          <label className="field">
            <span>{mode === 'changes' ? 'What should change? The Foreman stays in this stage and revises; nothing is approved.' : 'Your guidance or question for the Foreman. Nothing is approved.'}</span>
            <textarea
              ref={noteBox}
              className="text-area"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={busy}
              title={mode === 'changes'
                ? 'Say what the Foreman should change. It goes in your reply with your answers; the Foreman revises and briefs you again.'
                : 'A question or a note for the Foreman. It goes in your reply with your answers; this card stays open.'}
            />
          </label>
          <div className="perm-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !note.trim()}
              onClick={() => void act(mode, { note })}
              title={note.trim() ? (mode === 'changes' ? 'Send your answers and the changes you want. The Foreman revises before moving on.' : 'Send your answers and this guidance. The Foreman replies; the gate stays open.') : 'Write something first.'}
            >
              {mode === 'changes' ? 'Send the changes' : 'Send the guidance'}
            </button>
            <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => setMode(null)} title="Close this without sending. What you wrote is kept until the card goes.">Cancel</button>
          </div>
        </div>
      )}

      {mode === 'stop' && (
        <div className="gate-stop" role="group" aria-labelledby={`${uid}-stop`}>
          <p className="perm-warn" id={`${uid}-stop`}>
            Stop this job: the Foreman records where things stand and starts nothing else. Nothing is deleted; you can carry on later with a message.
            {running && ' The Foreman is working on a reply right now: stopping the job ends that reply first, then your stop waits in the message box until it has ended.'}
          </p>
          <label className="field">
            <span>Type the job’s name, <code>{slug}</code>, to confirm</span>
            <input
              ref={stopBox}
              className="text-input"
              value={stopName}
              onChange={(e) => setStopName(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              title={`Type ${slug} exactly. This makes sure you mean to stop this job.`}
            />
          </label>
          <label className="field">
            <span>A note for the Foreman (optional)</span>
            <textarea
              className="text-area"
              rows={2}
              value={stopNote}
              onChange={(e) => setStopNote(e.target.value)}
              disabled={busy}
              title="Why you’re stopping, or anything the Foreman should record. It goes with the stop."
            />
          </label>
          <div className="perm-actions">
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy || stopName.trim() !== slug}
              onClick={() => void stopJob()}
              title={stopName.trim() !== slug ? 'Type the job’s name above first.'
                : running ? 'End the reply in progress, then stop the job. No answers or option changes go with it.'
                  : 'Stop the job now. No answers or option changes go with it.'}
            >
              Stop the job
            </button>
            <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => setMode(null)} title="Don’t stop. Nothing is sent.">Cancel</button>
          </div>
        </div>
      )}

      <details className="gate-adjust" open={adjustOpen}>
        <summary className="gate-fold" onClick={(e) => { e.preventDefault(); setAdjustOpen(!adjustOpen); }} title="Change only the next step (or the level from the next step on): skip it, lighter, heavier, a Fable second look, do it yourself, L↑ or L↓. Each adds one line to your reply.">
          Adjust the next step{next ? ` (${next})` : ''} <span aria-hidden="true">▾</span> <Kbd id="gate-adjust" />
          {chosen.length > 0 && <span className="chip gate-chosen">{chosen.length === 1 ? '1 chosen' : `${chosen.length} chosen`}</span>}
        </summary>
        <div className="gate-chips" role="group" aria-label={`Next step only${next ? ` (${next})` : ''}`}>
          {views.map((v) => {
            const on = v.enabled && c.chips.includes(v.id);
            return (
              <button
                key={v.id}
                type="button"
                className="btn gate-chip"
                aria-label={v.name}
                aria-pressed={on}
                aria-disabled={!v.enabled || busy ? true : undefined}
                onClick={() => { if (v.enabled && !busy) toggle(v.id); }}
                title={v.hint}
              >
                {on ? '✓ ' : ''}{v.label}
              </button>
            );
          })}
        </div>
        {level === null && (
          <p className="muted gate-hint">
            L↑ and L↓ need a level.{' '}
            <button type="button" className="link-button" onClick={openLevelChip} title="Open the level chip in the job header to pick this job’s level.">Pick a level first</button>
          </p>
        )}
        {/* A stop carries no option changes, so its lines aren't shown while you stop. */}
        {chipLines.length > 0 && mode !== 'stop' && (
          <div className="gate-lines" aria-live="polite">
            <p className="muted gate-lines-head">Added to your reply, exactly:</p>
            <pre className="perm-preview gate-lines-text">{chipLines.join('\n')}</pre>
            {consequence && <p className="muted level-consequence">{consequence}.</p>}
          </div>
        )}
      </details>

      {askTerminal && (
        <label className="check" title="Claude Code is open in this repository in a terminal. Two Foremen on one job would trip over each other.">
          <input type="checkbox" checked={noTerminal} onChange={(e) => setNoTerminal(e.target.checked)} /> None of the open terminals is this job’s Foreman
        </label>
      )}
      {error && <p className="field-problem" role="alert">{error}</p>}

      <HowThisWorks id="gate-card" defaultOpen={false}>
        <p>The Foreman has briefed you and waits for your decision. Nothing goes ahead, and nothing is ever approved for you, until you press one of these.</p>
        <p><strong>Approve</strong> (its label says what it approves and what starts) sends your answers to the questions, confirms the decisions made on your behalf that you didn’t override, and names the versions you approved. <strong>Edit, then approve</strong> shows that reply in full so you can change the words first. <strong>Revise with feedback</strong> asks for changes: the Foreman stays in this stage. <strong>Other guidance</strong> sends a question or a note without approving; the card stays open. Approve needs an answer to every question (a recommended answer is picked for you); while it is off, the card lists why, and the list empties as you resolve each point. <strong>Approve, start after reset</strong> appears when Claude’s usage limit is reached: your approval waits and goes when it resets. <strong>Stop job</strong> is under ⋯ and asks you to type the job’s name.</p>
        <p><strong>Decisions made for you</strong> is folded to one line: open it to read each one, and <strong>Override</strong> marks one changed, with what it should be instead. <strong>Adjust the next step</strong> holds the chips, which change <strong>only the next step</strong>: skip it, make it lighter or heavier, ask Fable for a second look, do it yourself, or move the level up or down from there. Each adds one line to your reply, shown there exactly, and saves the job’s options where there is one.</p>
        <p>If the plan changes after the card appears, it greys out (“Plan changed since this was proposed”) so you can’t approve an old version. If the Foreman is still working, your reply waits in the message box until it finishes. A decision left 4 hours shows as parked.</p>
      </HowThisWorks>

      {editing !== null && (
        <SendPreview
          initial={editing}
          // The model the reply runs on: the Foreman's last one, else the everyday one (as the dashboard picks).
          model={detail.drive?.model ?? meta?.models?.[0]?.id ?? null}
          models={meta?.models ?? []}
          title="Edit, then approve"
          intro="This is your approval as the Foreman will receive it. Edit it, then send. The chips’ option changes are saved whatever you write here."
          sendLabel="Approve with this text"
          sendHint="Send this text as your approval of this brief (⌘/Ctrl+Enter)."
          // The plan changed while the sheet was open: sending is off (your text stays to copy).
          blocked={stale ? 'The plan changed since this card was raised, so this approval would be for an old version. Nothing was sent; close this and check the new version.' : null}
          submit={async (text, { confirmNoTerminal }) => { edited.current = await post('approve', { text, ...(confirmNoTerminal ? { confirmNoTerminal } : {}) }); }}
          onClose={closeEdit}
          onSent={() => { setEditing(null); if (edited.current) done('approve', edited.current); }}
        />
      )}
    </section>
  );
}

/** The proof stamp: which commit the checks ran on, and a warning when the branch has moved on since. */
function ProofStamp({ proof }: { proof: NonNullable<Gate['proof']> }) {
  const short = (sha: string) => sha.slice(0, 7);
  if (proof.stale && proof.head) {
    return (
      <p className="perm-warn gate-proof is-stale" title="The test report checked an older commit. Commits added since then haven’t been through the checks.">
        <span aria-hidden="true">⚠ </span>Checks ran on <code className="num">{short(proof.tested)}</code>; the branch is now at <code className="num">{short(proof.head)}</code>. Ask for the checks again before approving.
      </p>
    );
  }
  return (
    <p className="muted gate-proof" title={proof.head ? 'The test report checked the commit the branch is on now.' : 'The commit the test report checked. The branch’s head couldn’t be read, so it isn’t compared.'}>
      <span aria-hidden="true">✓ </span>Checked at <code className="num">{short(proof.tested)}</code>{proof.head ? ', the branch’s head' : ''}
    </p>
  );
}
