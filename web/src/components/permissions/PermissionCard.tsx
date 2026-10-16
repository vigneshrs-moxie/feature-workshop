// A permission card: the Foreman (or one of its crew) wants to do something your settings don't
// count as routine. Allow once · Allow for this reply (only when Claude Code offers it) · Deny,
// with an optional note telling it why · Always allow… (a rule you draft, edit and confirm).
import { useRef, useState } from 'react';
import type { Permission } from '../../api/types';
import { jobHref } from '../../app/router';
import { fullTime, relativeTime } from '../../lib/time';
import { AlwaysAllowSheet } from './AlwaysAllowSheet';
import { useAnswer } from './useAnswer';

export function CardHead({ p, now, showJob, verb }: { p: Permission; now: Date; showJob: boolean; verb: string }) {
  const who = p.agentType ? p.agentType : 'The Foreman';
  return (
    <header className="perm-head">
      <p className="perm-who">
        <strong>{who}</strong> {verb}
        {p.createdAt && <time className="thread-time num" dateTime={p.createdAt} title={`Asked ${fullTime(p.createdAt)}`}>{relativeTime(p.createdAt, now)}</time>}
      </p>
      {showJob && (
        <p className="perm-job muted">
          Job: <a href={jobHref(p.slug)} title="Open this job’s conversation.">{p.title || p.slug}</a>
        </p>
      )}
    </header>
  );
}

export function DenyBox({ busy, label, onDeny, onCancel }: { busy: boolean; label: string; onDeny: (note: string) => void; onCancel: () => void }) {
  const [note, setNote] = useState('');
  return (
    <div className="perm-deny">
      <label className="field">
        <span>Tell it why (optional)</span>
        <input
          type="text"
          className="text-input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onDeny(note); } }}
          placeholder="For example: don’t touch the database"
          title="Your note goes to the Foreman with the no, so it knows what to do instead."
          autoFocus
        />
      </label>
      <div className="perm-actions">
        <button type="button" className="btn btn-danger" disabled={busy} onClick={() => onDeny(note)} title="Send your no (and note, if you wrote one).">{label}</button>
        <button type="button" className="btn btn-quiet" disabled={busy} onClick={onCancel} title="Don’t say no after all; the card keeps waiting.">Cancel</button>
      </div>
    </div>
  );
}

export function PermissionCard({ permission: p, now, showJob = false }: { permission: Permission; now: Date; showJob?: boolean }) {
  const { busy, error, send } = useAnswer(p);
  const [denying, setDenying] = useState(false);
  const [sheet, setSheet] = useState(false);
  const alwaysBtn = useRef<HTMLButtonElement>(null);
  const plain = p.plain ?? { headline: `Use ${p.toolName ?? 'a tool'}` };
  const risky = plain.risk === 'high';
  const draft = p.draft && p.draft.options?.length ? p.draft : null;

  return (
    <article className={`thread-item perm-card${risky ? ' is-risky' : ''}`} data-ask={p.hardLine ? 'hardline' : 'permission'} aria-label={`Permission: ${plain.headline}`}>
      <CardHead p={p} now={now} showJob={showJob} verb="wants to" />
      <h3 className="perm-headline">{plain.headline}</h3>
      {plain.detail && <p className="perm-detail">{plain.detail}</p>}
      {plain.preview && <pre className="perm-preview">{plain.preview}</pre>}
      {p.hardLine ? (
        <p className="perm-reason muted" title="Hard lines ask you every time, whatever your permission setting, and can’t be always allowed.">
          <span className="chip ask-label">Hard line</span> {p.hardLine.reason}
        </p>
      ) : p.decisionReason && (
        <p className="perm-reason muted" title={p.fromAutoMode ? 'Auto mode’s safety model couldn’t decide this one by itself, so it asks you.' : 'Why Claude Code asked about this one.'}>
          {p.fromAutoMode ? <><span className="chip ask-label">Auto mode</span> </> : 'Why it asks: '}{p.decisionReason}
        </p>
      )}
      {risky && <p className="perm-warn" role="note"><span aria-hidden="true">⚠ </span>Take a careful look: this may be hard to undo.</p>}
      {error && <p className="field-problem" role="alert">{error}</p>}
      {denying ? (
        <DenyBox busy={busy} label="Deny" onDeny={(note) => void send({ decision: 'deny', note })} onCancel={() => setDenying(false)} />
      ) : (
        <div className="perm-actions">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void send({ decision: 'allow' })} title="Let it do exactly this, one time. It asks again next time.">Allow once</button>
          {p.canAllowForRun && (
            <button type="button" className="btn" disabled={busy} onClick={() => void send({ decision: 'allow-run' })} title="Let it do this kind of step without asking again until this reply is finished. Nothing is saved.">Allow for this reply</button>
          )}
          <button type="button" className="btn btn-danger" disabled={busy} onClick={() => setDenying(true)} title="Say no. It skips this and carries on; you can tell it why.">Deny…</button>
          {draft && (
            <button
              ref={alwaysBtn}
              type="button"
              className="btn btn-quiet"
              disabled={busy}
              onClick={() => setSheet(true)}
              title="Save a rule so steps like this run without asking, in every job the dashboard runs. You choose how narrow it is and confirm it first; remove it any time in Settings."
            >
              Always allow…
            </button>
          )}
        </div>
      )}
      {sheet && draft && <AlwaysAllowSheet permission={p} draft={draft} onClose={() => { setSheet(false); alwaysBtn.current?.focus(); }} />}
    </article>
  );
}
