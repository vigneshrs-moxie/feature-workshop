// The gate card (design doc section 3): pinned above the composer while the Foreman waits for your
// decision on a brief. It shows the brief's questions (the recommendation picked), the decisions
// made on your behalf (each one can be overridden), buttons that say what they do, and chips that
// change how the next stage runs. Everything goes in one reply through POST /api/job/:slug/gate:
// the dashboard composes it (composeReply, the same words the card previews), saves the chips'
// option changes, and sends it; or, while the Foreman is still working, gives the text back, which
// waits in the composer with the brief it answers. Nothing is ever approved automatically.
//
// GateSlot holds what outlives one card: the line saying what happened (the card itself goes once
// the brief is answered, or changes when the Foreman moves on to a new brief).
import { useEffect, useId, useRef, useState } from 'react';
import { ApiError } from '../../api/client';
import type { Gate, GateRequest, GateResult, Job, JobDetail } from '../../api/types';
import { sendGate } from '../../app/jobActions';
import { HowThisWorks } from '../../components/HowThisWorks';
import { composeGate, type GateKind } from '../../lib/compose';
import {
  answersFor, approveLabel, chipsFor, chipViews, decidedKey, emptyOverride, gateDraftKey, gateRequest, initialChoices,
  openDecisions, openGate, OTHER, readGateMemo, toggleChip, verdictsFor, type ChipId, type GateChoices,
} from '../../lib/gateCard';
import { isLevel, levelChange, lensNames } from '../../lib/levels';
import { readStored, useStored, writeStored } from '../../lib/stored';
import { clockTime, fullTime, relativeTime } from '../../lib/time';
import { useWorkshop, useWorkshopState } from '../../state/store';
import { stageLabel } from '../Jobs/stages';
import { draftKey, SendPreview } from './Composer';

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

export function GateSlot({ job, detail, now, reload }: { job: Job; detail: JobDetail; now: Date; reload(): void }) {
  const [notice, setNotice] = useState<GateNotice | null>(null);
  const [memoRaw, setMemo] = useStored(gateDraftKey(job.slug));
  const [draft] = useStored(draftKey(job.slug));
  const memo = draft?.trim() ? readGateMemo(memoRaw) : null;
  const gate = openGate(detail, Boolean(job.closed));
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
          <p className="muted">Send it once the Foreman finishes the reply in progress. Until it goes, this brief stays open.</p>
          <div className="perm-actions">
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => setMemo(null)}
              title="Decide on this brief again here. The text in the message box stays, as an ordinary message, until you clear it."
            >
              Decide again here
            </button>
          </div>
        </section>
      ) : (
        <GateCard key={`${job.slug}#${gate.briefNumber ?? '-'}`} job={job} detail={detail} gate={gate} now={now} reload={reload} report={setNotice} />
      ))}
    </>
  );
}

type Mode = null | 'changes' | 'message' | 'stop';

function GateCard({ job, detail, gate, now, reload, report }: {
  job: Job; detail: JobDetail; gate: Gate; now: Date; reload(): void; report(n: GateNotice): void;
}) {
  const { api } = useWorkshop();
  const { meta, usage } = useWorkshopState();
  const slug = job.slug;
  const uid = useId();
  const headId = `${uid}-head`;
  const [c, setC] = useState<GateChoices>(() => initialChoices(gate));
  const [mode, setMode] = useState<Mode>(null);
  const [note, setNote] = useState('');
  const [stopName, setStopName] = useState('');
  const [stopNote, setStopNote] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askTerminal, setAskTerminal] = useState(false);
  const [noTerminal, setNoTerminal] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const edited = useRef<GateResult | null>(null);
  const moreBtn = useRef<HTMLButtonElement>(null);
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
  const consequence = levelChip && levelChip.kind === 'level' ? levelChange(level, levelChip.level, levels, lensNames(meta)).text : null;
  const decided = openDecisions(gate);
  const stale = gate.stale;
  const limited = Boolean(usage?.limited);
  const next = gate.nextStage ? stageLabel(gate.nextStage) : null;
  const stage = stageLabel(gate.stage);
  const approve = approveLabel(gate, c.chips);

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

  /** Send one decision; a refusal throws (a stale brief also refetches the job and says so). */
  async function post(kind: GateKind, extra: Partial<GateRequest> = {}): Promise<GateResult> {
    const missing = kind === 'stop' ? null : emptyOverride(gate, c);
    if (missing) throw new Error(`Say what “${missing.decision}” should be instead, or undo that override.`);
    const body = gateRequest(kind, gate, c, views, { ...(noTerminal ? { confirmNoTerminal: true } : {}), ...extra });
    try {
      return await sendGate(api, slug, body);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.body.code === 'stale-brief') {
        reload();
        report({ tone: 'problem', text: err.message, focus: 'notice' });
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
      // The Foreman is still working: the reply waits in the composer, remembering its brief.
      const existing = (readStored(draftKey(slug)) ?? '').trim();
      writeStored(draftKey(slug), existing && existing !== r.text ? `${existing}\n\n${r.text}` : r.text);
      if (gate.briefNumber) writeStored(gateDraftKey(slug), JSON.stringify({ brief: gate.briefNumber, kind }));
      report({
        tone: 'ok',
        text: `The Foreman is still working; your reply is ready to send when it finishes. It’s in the message box below.${r.options ? ' The option changes are saved already.' : ''}${dropped}`,
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
      if (err instanceof ApiError && err.body.code === 'stale-brief') return; // said in the slot; the card is refetched
      if (err instanceof ApiError && err.body.code === 'terminal-open') setAskTerminal(true);
      setError(err instanceof ApiError && err.body.code === 'terminal'
        ? 'This job’s Foreman was last used in your terminal. Take it over in the classic view first, or carry on in the terminal.'
        : message(err));
    } finally {
      setBusy(false);
    }
  }

  function openEdit() {
    const missing = emptyOverride(gate, c);
    if (missing) { setError(`Say what “${missing.decision}” should be instead, or undo that override.`); return; }
    setError(null);
    setEditing(composeGate({ kind: 'approve', answers: answersFor(gate, c), verdicts: verdictsFor(gate, c, 'approve'), chips }, detail.statusForCompose));
  }

  function openMode(m: Mode) {
    setError(null);
    setMenuOpen(false);
    setMode((now) => (now === m ? null : m));
  }

  const resetAt = usage?.resetsAt ? clockTime(usage.resetsAt, now) : '';
  const waited = waitedText(gate.waitingSince, now);
  const approveHint = `${approve}. Sends your answers, confirms the decisions you didn’t override, adds the chips’ lines, and says “At these versions”.${gate.nextProposed ? ` The Foreman goes ahead with: ${gate.nextProposed}.` : ''}`;
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
        <h3 className="perm-headline" id={headId}>{gate.headline ?? 'The Foreman waits for your decision'}</h3>
        {gate.nextProposed && <p className="muted gate-next" title="What the Foreman proposes to do once you approve.">Next, as proposed: {gate.nextProposed}</p>}
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

      {gate.questions.map((q, i) => {
        const group = `${uid}-q${i}`;
        const otherId = `${group}-other`;
        return (
          <fieldset key={q.id} className="question gate-question" disabled={busy}>
            <legend>{i + 1}. {q.text}</legend>
            {q.options.map((o) => (
              <label key={o.id} className="answer-option" title={o.id === q.recommendation ? 'The Foreman recommends this answer; it’s picked for you. Pick another to change it.' : 'Answer with this option.'}>
                <input type="radio" name={group} value={o.id} checked={c.choices[q.id] === o.id} onChange={() => setChoice(q.id, o.id)} />
                <span className="answer-label">
                  {o.id}) {o.label}
                  {o.id === q.recommendation && <> <span className="chip gate-rec">Recommended</span></>}
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
        <section className="gate-decided" aria-labelledby={`${uid}-dec`}>
          <h4 className="gate-subhead muted" id={`${uid}-dec`}>Also decided on your behalf</h4>
          <ul className="gate-decided-list">
            {decided.map((d) => {
              const key = decidedKey(d);
              const over = key in c.overrides;
              return (
                <li key={key} className={`gate-decision${over ? ' is-changed' : ''}`}>
                  <p className="gate-decision-text">
                    {over && <><span className="chip gate-changed">Changed</span> </>}
                    <strong>{d.decision}</strong>
                    {d.reason && <span className="muted"> — {d.reason}</span>}
                    {d.where && <span className="muted"> ({d.where})</span>}
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
      )}

      <div className="perm-actions gate-actions">
        <button type="button" className="btn btn-primary" disabled={busy || stale} onClick={() => void act('approve')} title={stale ? staleHint : approveHint}>
          {approve}
        </button>
        <button type="button" className="btn" disabled={busy || stale} onClick={openEdit} title={stale ? staleHint : 'See the whole reply exactly as the Foreman will receive it, edit it, then send it as your approval.'}>
          Edit, then approve
        </button>
        <button type="button" className="btn" disabled={busy} aria-expanded={mode === 'changes'} onClick={() => openMode('changes')} title="Ask for changes: the Foreman stays in this stage and revises. Nothing is approved.">
          Revise with feedback
        </button>
        <button type="button" className="btn" disabled={busy} aria-expanded={mode === 'message'} onClick={() => openMode('message')} title="Tell the Foreman something else: a question or guidance. Nothing is approved.">
          Other guidance
        </button>
        {limited && (
          <button
            type="button"
            className="btn"
            disabled={busy || stale}
            onClick={() => void act('approve', { startAfterReset: true })}
            title={stale ? staleHint : `Approve now; the reply is held and goes to the Foreman when Claude’s usage limit resets${resetAt ? ` (around ${resetAt})` : ''}.`}
          >
            Approve, start after reset
          </button>
        )}
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
            <textarea ref={noteBox} className="text-area" rows={3} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
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
          <p className="perm-warn" id={`${uid}-stop`}>Stop this job: the Foreman records where things stand and starts nothing else. Nothing is deleted; you can carry on later with a message.</p>
          <label className="field">
            <span>Type the job’s name, <code>{slug}</code>, to confirm</span>
            <input ref={stopBox} className="text-input" value={stopName} onChange={(e) => setStopName(e.target.value)} autoComplete="off" spellCheck={false} disabled={busy} />
          </label>
          <label className="field">
            <span>A note for the Foreman (optional)</span>
            <textarea className="text-area" rows={2} value={stopNote} onChange={(e) => setStopNote(e.target.value)} disabled={busy} />
          </label>
          <div className="perm-actions">
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy || stopName.trim() !== slug}
              onClick={() => void act('stop', { note: stopNote })}
              title={stopName.trim() === slug ? 'Stop the job now. No answers or option changes go with it.' : 'Type the job’s name above first.'}
            >
              Stop the job
            </button>
            <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => setMode(null)} title="Don’t stop. Nothing is sent.">Cancel</button>
          </div>
        </div>
      )}

      <div className="gate-chips" role="group" aria-labelledby={`${uid}-chips`}>
        <span className="muted gate-chips-label" id={`${uid}-chips`} title="These change only the next stage (or the level from the next stage on). Each adds one line to your reply.">
          Next step only{next ? ` (${next})` : ''}:
        </span>
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
      {chipLines.length > 0 && (
        <div className="gate-lines" aria-live="polite">
          <p className="muted gate-lines-head">Added to your reply, exactly:</p>
          <pre className="perm-preview gate-lines-text">{chipLines.join('\n')}</pre>
          {consequence && <p className="muted level-consequence">{consequence}.</p>}
        </div>
      )}

      {askTerminal && (
        <label className="check" title="Claude Code is open in this repository in a terminal. Two Foremen on one job would trip over each other.">
          <input type="checkbox" checked={noTerminal} onChange={(e) => setNoTerminal(e.target.checked)} /> None of the open terminals is this job’s Foreman
        </label>
      )}
      {error && <p className="field-problem" role="alert">{error}</p>}

      <HowThisWorks id="gate-card" defaultOpen={false}>
        <p>The Foreman has briefed you and waits for your decision. Nothing goes ahead, and nothing is ever approved for you, until you press one of these.</p>
        <p><strong>Approve</strong> (its label says what it approves and what starts) sends your answers to the questions, confirms the decisions made on your behalf that you didn’t override, and names the versions you approved. <strong>Edit, then approve</strong> shows that reply in full so you can change the words first. <strong>Revise with feedback</strong> asks for changes: the Foreman stays in this stage. <strong>Other guidance</strong> sends a question or a note without approving. <strong>Approve, start after reset</strong> appears when Claude’s usage limit is reached: your approval waits and goes when it resets. <strong>Stop job</strong> is under ⋯ and asks you to type the job’s name.</p>
        <p><strong>Override</strong> on an “Also decided” item marks it changed, with what it should be instead. The chips change <strong>only the next step</strong>: skip it, make it lighter or heavier, ask Fable for a second look, do it yourself, or move the level up or down from there. Each adds one line to your reply, shown under the chips, and saves the job’s options where there is one.</p>
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
          submit={async (text, { confirmNoTerminal }) => { edited.current = await post('approve', { text, ...(confirmNoTerminal ? { confirmNoTerminal } : {}) }); }}
          onClose={() => setEditing(null)}
          onSent={() => { setEditing(null); if (edited.current) done('approve', edited.current); }}
        />
      )}
    </section>
  );
}
