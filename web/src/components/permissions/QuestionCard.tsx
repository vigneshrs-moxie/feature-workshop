// A question card: the Foreman asks you to choose (Claude Code's AskUserQuestion). One group per
// question, single or multiple choice, always with "Something else" for your own words. Send
// answers is ready once every question has an answer; "Don't answer…" says no, with a note.
import { useState } from 'react';
import type { AskedQuestion, Permission } from '../../api/types';
import { plainInline } from '../../lib/inlineMarkdown';
import { InlineText } from '../InlineText';
import { CardHead, DenyBox } from './PermissionCard';
import { useAnswer } from './useAnswer';

interface Pick { picked: string[]; other: boolean; otherText: string }
const EMPTY: Pick = { picked: [], other: false, otherText: '' };

/** The answer sent for one question: the labels picked and your own words, joined. */
export function answerFor(a: Pick): string {
  return [...a.picked, ...(a.other && a.otherText.trim() ? [a.otherText.trim()] : [])].join(', ');
}

function QuestionGroup({ q, i, pick, onChange, disabled }: { q: AskedQuestion; i: number; pick: Pick; onChange: (p: Pick) => void; disabled: boolean }) {
  const multi = Boolean(q.multiSelect);
  const name = `q${i}`;
  const toggle = (label: string) => {
    if (multi) onChange({ ...pick, picked: pick.picked.includes(label) ? pick.picked.filter((l) => l !== label) : [...pick.picked, label] });
    else onChange({ ...pick, picked: [label], other: false });
  };
  return (
    <fieldset className="question" disabled={disabled}>
      <legend>
        {q.header ? <span className="chip">{q.header}</span> : null} <InlineText text={q.question} />
      </legend>
      {multi && <p className="muted question-hint">Pick any that apply.</p>}
      {(q.options ?? []).map((o) => (
        <label key={o.label} className="answer-option" title={multi ? 'Tick this answer; you can pick more than one.' : 'Pick this answer.'}>
          <input type={multi ? 'checkbox' : 'radio'} name={name} checked={pick.picked.includes(o.label)} onChange={() => toggle(o.label)} />
          <span>
            <span className="answer-label"><InlineText text={o.label} /></span>
            {o.description && <span className="answer-desc muted"><InlineText text={o.description} /></span>}
          </span>
        </label>
      ))}
      <label className="answer-option" title="None of these fits: answer in your own words.">
        <input
          type={multi ? 'checkbox' : 'radio'}
          name={name}
          checked={pick.other}
          onChange={() => onChange(multi ? { ...pick, other: !pick.other } : { ...pick, picked: [], other: true })}
          aria-label="Something else"
        />
        <span className="answer-other">
          <span className="answer-label">Something else:</span>
          <input
            type="text"
            className="text-input"
            value={pick.otherText}
            onChange={(e) => onChange({ ...pick, other: true, picked: multi ? pick.picked : [], otherText: e.target.value })}
            aria-label={`Your own answer to: ${plainInline(q.question)}`}
            title="Answer in your own words instead."
          />
        </span>
      </label>
    </fieldset>
  );
}

export function QuestionCard({ permission: p, now, showJob = false }: { permission: Permission; now: Date; showJob?: boolean }) {
  const { busy, error, send } = useAnswer(p);
  const questions = Array.isArray(p.input?.questions) ? p.input.questions : [];
  const [picks, setPicks] = useState<Pick[]>(() => questions.map(() => EMPTY));
  const [denying, setDenying] = useState(false);
  const answers = questions.map((q, i) => [q.question, answerFor(picks[i] ?? EMPTY)] as const);
  const ready = questions.length > 0 && answers.every(([, a]) => a);

  return (
    <article className="thread-item perm-card question-card" data-ask="question" aria-label={`Question: ${questions[0]?.question ? plainInline(questions[0].question) : 'from the Foreman'}`}>
      <CardHead p={p} now={now} showJob={showJob} verb={questions.length === 1 ? 'asks you' : `asks you ${questions.length} questions`} />
      <form
        onSubmit={(e) => { e.preventDefault(); if (ready) void send({ decision: 'allow', answers: Object.fromEntries(answers) }); }}
      >
        {questions.map((q, i) => (
          <QuestionGroup key={i} q={q} i={i} pick={picks[i] ?? EMPTY} disabled={busy || denying} onChange={(n) => setPicks((ps) => ps.map((x, k) => (k === i ? n : x)))} />
        ))}
        {questions.length === 0 && <p className="muted">The question didn’t come through. You can say no, and the Foreman will ask again in its reply.</p>}
        {error && <p className="field-problem" role="alert">{error}</p>}
        {!denying && (
          <div className="perm-actions">
            <button type="submit" className="btn btn-primary" disabled={busy || !ready} title={ready ? 'Send your answers to the Foreman.' : 'Answer every question first.'}>Send answers</button>
            <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => setDenying(true)} title="Don’t answer. The Foreman carries on without your choice; you can tell it why.">Don’t answer…</button>
          </div>
        )}
      </form>
      {denying && <DenyBox busy={busy} label="Don’t answer" onDeny={(note) => void send({ decision: 'deny', note })} onCancel={() => setDenying(false)} />}
    </article>
  );
}
