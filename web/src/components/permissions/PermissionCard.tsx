// A permission card: the Foreman (or one of its crew) wants to do something your settings don't
// count as routine. Allow once · Allow for this reply (only when Claude Code offers it) · Deny,
// with an optional note telling it why · Always allow… (a rule you draft, edit and confirm).
import { useRef, useState } from 'react';
import type { Permission } from '../../api/types';
import { jobHref } from '../../app/router';
import { fullTime, relativeTime } from '../../lib/time';
import { askedLine, isOpen, needsLook, QueuedDecision, queuedOf } from '../../views/Hosted/QueuedDecision';
import { ServerHtml } from '../../panes/Foreman/ServerHtml';
import { FridayEyebrow } from '../../play/FridayEyebrow';
import { InlineText } from '../InlineText';
import { Button } from '../Button';
import { AlwaysAllowSheet } from './AlwaysAllowSheet';
import { useAnswer } from './useAnswer';

/**
 * A Markdown file it wants to write: shown as a page (the dashboard rendered it), or as its source.
 * Instructions files (CLAUDE.md, AGENTS.md, SKILL.md, .claude/) and files outside the job's folder
 * start on the source (the dashboard says so with previewStart), so you read exactly what it writes.
 */
function MarkdownPreview({ html, source, startOnSource }: { html: string; source: string; startOnSource: boolean }) {
  const [raw, setRaw] = useState(startOnSource);
  return (
    <div className="perm-md">
      <div className="perm-md-bar">
        <Button kind="quiet" size="sm" icon={raw ? 'file' : 'code'} aria-pressed={raw} onClick={() => setRaw((r) => !r)} title={raw ? 'Show the file as a formatted page.' : 'Show exactly what it will write, as Markdown source.'}>
          {raw ? 'Show as page' : 'Show source'}
        </Button>
      </div>
      {raw ? <pre className="perm-preview">{source}</pre> : <ServerHtml html={html} className="perm-preview-page" />}
    </div>
  );
}

export function CardHead({ p, now, showJob, verb }: { p: Permission; now: Date; showJob: boolean; verb: string }) {
  const who = p.agentType ? p.agentType : 'The Foreman';
  return (
    <header className="perm-head">
      <p className="perm-who">
        <strong>{who}</strong> {verb}
        {p.createdAt && <time className="thread-time num" dateTime={p.createdAt} title={`Asked ${fullTime(p.createdAt)}`}>{relativeTime(p.createdAt, now)}</time>}
      </p>
      {typeof p.expiresAt === 'string' && <p className="perm-asked muted num">{askedLine(p.createdAt, p.expiresAt, now)}</p>}
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
        <Button kind="danger" disabled={busy} onClick={() => onDeny(note)} title="Send your no (and note, if you wrote one).">{label}</Button>
        <Button kind="quiet" disabled={busy} onClick={onCancel} title="Don’t say no after all; the card keeps waiting.">Cancel</Button>
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
  const queued = queuedOf(p.queued);

  return (
    <article className={`thread-item perm-card${risky ? ' is-risky' : ''}`} data-ask={p.hardLine ? 'hardline' : 'permission'} aria-label={`Permission: ${plain.headline}`}>
      <CardHead p={p} now={now} showJob={showJob} verb="wants to" />
      <h3 className="perm-headline">{plain.headline}</h3>
      {/* Only the tool's own description is formatted; the path and the preview are shown exactly as written. */}
      {plain.detail && <p className="perm-detail"><InlineText text={plain.detail} /></p>}
      {plain.blockedPath && (
        <p className="perm-detail perm-blocked" title="This step reaches a folder outside the job’s project, so it asks you first.">
          It touches a folder outside the project: <code className="inline-code perm-path">{plain.blockedPath}</code>
        </p>
      )}
      {plain.preview && (plain.previewHtml
        ? <MarkdownPreview html={plain.previewHtml} source={plain.preview} startOnSource={plain.previewStart === 'source'} />
        : <pre className="perm-preview">{plain.preview}</pre>)}
      {plain.preview && plain.previewCut ? (
        <p className="perm-cut muted" title="Only the start is shown here, so the card stays short. The whole step is what you approve.">
          Shortened: first {plain.previewCut.toLocaleString('en')} characters
        </p>
      ) : null}
      {p.hardLine ? (
        <p className="perm-reason muted" title="Hard lines ask you before they run (in auto mode, unless your go-ahead covers them) and can’t be always allowed.">
          <span className="chip ask-label">Hard line</span> {p.hardLine.reason}
        </p>
      ) : p.decisionReason && (
        <p className="perm-reason muted" title={p.fromAutoMode ? 'Auto mode’s safety model couldn’t decide this one by itself, so it asks you.' : 'Why Claude Code asked about this one.'}>
          {p.fromAutoMode ? <><span className="chip ask-label">Auto mode</span> </> : 'Why it asks: '}<InlineText text={p.decisionReason} />
        </p>
      )}
      {risky && <p className="perm-warn" role="note"><span aria-hidden="true">⚠ </span>Take a careful look: this may be hard to undo.</p>}
      {error && <p className="field-problem" role="alert">{error}</p>}
      {needsLook(queued) && <QueuedDecision queued={queued} />}
      {isOpen(queued) ? <QueuedDecision queued={queued} /> : denying ? (
        <DenyBox busy={busy} label="Deny" onDeny={(note) => void send({ decision: 'deny', note })} onCancel={() => setDenying(false)} />
      ) : (
        <div className="perm-actions">
          <Button kind="primary" keyId={!p.hardLine && !p.defaultToNo ? 'desk-approve' : undefined} keyShown disabled={busy} onClick={() => void send({ decision: 'allow' })} title="Let it do exactly this, one time. It asks again next time.">Allow once</Button>
          {p.canAllowForRun && (
            <Button disabled={busy} onClick={() => void send({ decision: 'allow-run' })} title="Let it do this kind of step without asking again until this reply is finished. Nothing is saved.">Allow for this reply</Button>
          )}
          <Button keyId="desk-deny" disabled={busy} onClick={() => setDenying(true)} title="Say no. It skips this and carries on; you can tell it why.">Deny…</Button>
          {draft && (
            <Button
              ref={alwaysBtn}
              kind="quiet"
              disabled={busy}
              onClick={() => setSheet(true)}
              title="Save a rule so steps like this run without asking, in every job the dashboard runs. You choose how narrow it is and confirm it first; remove it any time in Settings."
            >
              Always allow…
            </Button>
          )}
        </div>
      )}
      {/* Play: a look from the Locksmith on a Friday-afternoon push, under the buttons. */}
      <FridayEyebrow permission={p} now={now} />
      {sheet && draft && <AlwaysAllowSheet permission={p} draft={draft} onClose={() => { setSheet(false); alwaysBtn.current?.focus(); }} />}
    </article>
  );
}
