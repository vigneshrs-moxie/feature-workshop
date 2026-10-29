// The permission alert (packet M): the card at the top of the Job page and the Stage when the
// Foreman or a crew member asks to do something that needs your yes. Built on PermissionCard's
// parts: what it wants in plain words, the exact step underneath (folded when long), why it asks,
// what each answer does, then Allow once and Deny… (and Allow for this reply where Claude Code
// offers it). "Always allow for this job" shows only where remembering is allowed: never for a
// hard line or a step Claude Code flagged as risky, and only once the dashboard says it can keep
// a rule for one job (canAllowForJob); until then the card keeps today's "Always allow…", which
// drafts a rule for every job. The a key allows once, never a hard line or a risky step; d opens
// Deny. A shield and the word Permission say what it is, never colour alone. More waiting fold
// under it, oldest first.
import { useRef, useState } from 'react';
import type { Permission } from '../../api/types';
import { useKeyScope } from '../../app/keyRegistry';
import { relativeTime } from '../../lib/time';
import { roleOf } from '../../play/crewPack';
import { Icon } from '../Icon';
import { FoldShow } from '../page/Page';
import { InlineText } from '../InlineText';
import { Kbd } from '../Kbd';
import { AlwaysAllowSheet } from './AlwaysAllowSheet';
import { DenyBox } from './PermissionCard';
import { Card } from './PendingCards';
import { QuestionCard } from './QuestionCard';
import { useAnswer } from './useAnswer';

const byAge = (a: Permission, b: Permission) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''));

/** The exact step: its preview, else the command it runs, else the file it touches. */
export function exactStep(p: Permission): string | null {
  const plain = p.plain;
  if (plain?.preview) return plain.preview;
  const input = p.input ?? {};
  for (const k of ['command', 'file_path', 'path', 'url', 'pattern']) {
    const v = (input as Record<string, unknown>)[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return null;
}

/** Long steps fold, so the card stays short: more than three lines or 240 characters. */
export const isLong = (text: string) => text.split('\n').length > 3 || text.length > 240;

/** One key allows it: not a hard line, not a step Claude Code flagged as risky, not a question. */
export const oneKeyAllow = (p: Permission) => p.kind !== 'question' && !p.hardLine && !p.defaultToNo && p.plain?.risk !== 'high';

/** "Always allow for this job" is offered: the dashboard can keep it for one job, and it isn't a hard line or risky. */
export const offersJobAlways = (p: Permission) => p.canAllowForJob === true && !p.hardLine && !p.defaultToNo;

function Alert({ p, now, more }: { p: Permission; now: Date; more: number }) {
  const { busy, error, send } = useAnswer(p);
  const [denying, setDenying] = useState(false);
  const [sheet, setSheet] = useState(false);
  const alwaysBtn = useRef<HTMLButtonElement>(null);
  const plain = p.plain ?? { headline: `Use ${p.toolName ?? 'a tool'}` };
  const who = p.agentType ? `The ${roleOf(p.agentType)}` : 'The Foreman';
  const step = exactStep(p);
  const hard = Boolean(p.hardLine);
  const keyOk = oneKeyAllow(p);
  const why = p.hardLine?.reason ?? p.decisionReason ?? null;
  const draft = p.draft && p.draft.options?.length && !hard && !p.defaultToNo ? p.draft : null;
  const jobAlways = offersJobAlways(p);
  const waited = p.createdAt ? relativeTime(p.createdAt, now) : '';

  // a allows once (never a hard line or a risky step: then it does nothing at all); d opens Deny.
  useKeyScope('alert', {
    'alert-allow': () => { if (keyOk && !busy && !denying) void send({ decision: 'allow' }); },
    'alert-deny': () => { if (!busy) setDenying(true); },
  });

  return (
    <section className={`perm-alert${hard ? ' is-hard' : ''}`} data-ask={hard ? 'hardline' : 'permission'} aria-label={`Permission: ${plain.headline}`}>
      <header className="perm-alert-top">
        <span className="perm-alert-shield" aria-hidden="true"><Icon name="shield" size={22} /></span>
        <div className="perm-alert-say">
          <span className="next-label">Permission{waited ? ` · waiting ${/^\d+[mhd]$/.test(waited) ? waited : waited.toLowerCase()}` : ''}</span>
          <h3 className="perm-alert-head">{who} wants to {lowerFirst(plain.headline)}</h3>
        </div>
        {hard && <span className="chip perm-hard-chip"><Icon name="octagon" size={12} /> Hard line</span>}
      </header>
      {plain.detail && <p className="perm-detail"><InlineText text={plain.detail} /></p>}
      {plain.blockedPath && (
        <p className="perm-detail perm-blocked">It touches a folder outside the project: <code className="inline-code perm-path">{plain.blockedPath}</code></p>
      )}
      {step && (isLong(step) ? (
        <details className="perm-step">
          <summary title="Show exactly what it will run or write.">The exact step <span className="muted">· {step.split('\n').length} lines</span></summary>
          <pre className="perm-preview">{step}</pre>
        </details>
      ) : (
        <div className="perm-step is-short"><span className="muted">The exact step</span><code>{step}</code></div>
      ))}
      {why && <p className="perm-why"><b>Why it asks:</b> <InlineText text={why} /></p>}
      <div className="perm-what">
        <div><b><Icon name="check" size={14} /> Allow once</b><span>It does exactly this, one time, then carries on. It asks again next time.</span></div>
        <div><b><Icon name="x" size={14} /> Deny</b><span>It skips this and carries on without it; you can tell it why.</span></div>
      </div>
      {error && <p className="field-problem" role="alert">{error}</p>}
      {denying ? (
        <DenyBox busy={busy} label="Deny" onDeny={(note) => void send({ decision: 'deny', note })} onCancel={() => setDenying(false)} />
      ) : (
        <div className="perm-actions perm-alert-actions">
          <button type="button" className="btn btn-primary btn-lg" disabled={busy} onClick={() => void send({ decision: 'allow' })} title="Let it do exactly this, one time. It asks again next time.">
            <Icon name="check" size={16} /> Allow once{keyOk && <Kbd id="alert-allow" />}
          </button>
          <button type="button" className="btn btn-danger btn-lg" disabled={busy} onClick={() => setDenying(true)} title="Say no. It skips this and carries on; you can tell it why.">
            <Icon name="x" size={16} /> Deny…<Kbd id="alert-deny" />
          </button>
          {p.canAllowForRun && !hard && (
            <button type="button" className="btn" disabled={busy} onClick={() => void send({ decision: 'allow-run' })} title="Let it do this kind of step without asking again until this reply is finished. Nothing is saved.">Allow for this reply</button>
          )}
          {jobAlways ? (
            <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void send({ decision: 'allow-job' })} title="Let steps like this run without asking for the rest of this job. Other jobs still ask; rules for every job are in Settings.">Always allow for this job</button>
          ) : draft && (
            <button ref={alwaysBtn} type="button" className="btn btn-quiet" disabled={busy} onClick={() => setSheet(true)} title="Save a rule so steps like this run without asking, in every job. You choose how narrow it is and confirm it first; remove it any time in Settings.">Always allow…</button>
          )}
          {!keyOk && <span className="perm-reason"><Icon name="help" size={14} /> {hard ? 'A key never allows a hard line.' : 'A key never allows a risky step.'}</span>}
        </div>
      )}
      {more > 0 && <span className="sr-only">{more} more waiting below.</span>}
      {sheet && draft && <AlwaysAllowSheet permission={p} draft={draft} onClose={() => { setSheet(false); alwaysBtn.current?.focus(); }} />}
    </section>
  );
}

const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/**
 * The alert for the oldest request waiting on this job (`only`: just these, such as one stop's),
 * and "n more waiting · oldest first" folded under it. A question shows as its own card.
 */
export function PermissionAlert({ permissions, now }: { permissions: readonly Permission[]; now: Date }) {
  const list = [...permissions].sort(byAge);
  if (!list.length) return null;
  const [first, ...rest] = list;
  return (
    <div className="perm-alert-slot">
      {first.kind === 'question' ? <QuestionCard permission={first} now={now} /> : <Alert key={first.id} p={first} now={now} more={rest.length} />}
      {rest.length > 0 && (
        <details className="fold perm-more">
          <summary className="fold-head" title="Show the other requests waiting, oldest first.">
            <Icon name="shield" size={14} />
            <span className="fold-name">{rest.length} more waiting</span>
            <span className="muted fold-note">· oldest first</span>
            <FoldShow />
          </summary>
          <div className="fold-body pending-cards">
            {rest.map((p) => <Card key={p.id} p={p} now={now} />)}
          </div>
        </details>
      )}
    </div>
  );
}

