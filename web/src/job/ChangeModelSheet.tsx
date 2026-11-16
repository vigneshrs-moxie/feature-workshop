// Change the Foreman's model (spec 1.5). The model is fixed for a started job: another one starts
// the job again from step one (POST /api/job/:slug/restart, dashboard/lib/restart.js). The sheet
// says exactly what leaves the job and where it is kept, then asks for the job's name, as Stop job
// does. With a pull request in play it says only why the model can't change.
import { useEffect, useRef, useState } from 'react';
import type { JobDetail, ModelChoice } from '../api/types';
import { BRAND } from '../app/brand';
import { navigate } from '../app/router';
import { Button } from '../components/Button';
import { Field, TextInput } from '../components/Field';
import { Select } from '../components/Select';
import { Sheet } from '../components/Sheet';
import { FoldShow } from '../components/page/Page';
import { isActiveRun } from '../panes/Foreman/thread';
import { useWorkshop, useWorkshopPick } from '../state/store';
import '../views/JobSheets/jobSheets.css';

export const PR_REASON = 'This job has an open pull request, so its model can\'t change: reviewed work would be thrown away. Close the pull request, or start a new job.';
/** The design's lines (feedback-round design, Change model), shown first. */
export const CONSEQUENCES = [
  'The job starts again from step one on the new model.',
  'Its spec, plan, briefs and decisions so far leave the job. They are kept in an archive folder.',
  'Its code so far leaves the job. The commits are kept on a backup branch, and the job gets a fresh branch.',
  'The time and usage already spent are not recovered.',
];
/** The ruling's sentence for Auto: with the first lines when the job has Auto on, else in the fold. */
export const AUTO_RESTART = 'A restart switches Auto off. Turn it on again on the new job if you want it.';
/** What else a restart moves, so nothing is lost without being said: under one fold. */
export const MORE_CONSEQUENCES = [
  'Changes not yet committed stay in the old worktree folder, which is moved aside.',
  'Files git ignores, such as .env and node_modules, stay in that old folder too. They are not in the job\'s new worktree.',
  'The Foreman\'s conversation so far is not carried over; a copy of its session record goes in the archive folder.',
  'The job\'s options are kept (level, screens, reviewers, models and the rest). The job\'s own permission setting is not kept.',
  'A reply waiting to be sent, or a carry-on waiting for the usage limit, is not sent. A copy goes in the archive folder.',
  'A link to a past conversation the job was started from is not carried over.',
  `${BRAND.name} first checks GitHub, and won't restart a job whose branch is already there.`,
  'Nothing is deleted and nothing is pushed.',
  'If something goes wrong before the new job starts, everything is put back and you are told. If that can\'t be done, you are told where everything is.',
];

/** A pull request in play (open, in review, approved or merged): the same rule as the dashboard's. */
export function hasPullRequest(prs: JobDetail['prs']): boolean {
  return (prs ?? []).some((p) => {
    const state = String(p?.state ?? '').toLowerCase();
    return state ? !['not_started', 'closed'].includes(state) : Boolean(p?.url);
  });
}

interface Restarted { slug: string; archive: string; backupBranch: string | null; worktreeAside: string | null; notes?: string[] }

export function ChangeModelSheet({ slug, onClose }: { slug: string; onClose: () => void }) {
  const { api } = useWorkshop();
  const { meta, runs } = useWorkshopPick('meta', 'runs');
  const models: ModelChoice[] = meta?.models ?? [];
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Restarted | null>(null);
  // m5: the sheet opens on "Loading…", with nothing to focus; once the job is in, the focus goes to
  // the name box (or Close, when a pull request means there is nothing to confirm).
  const nameBox = useRef<HTMLInputElement>(null);
  const closeBox = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<JobDetail>(`/api/job/${encodeURIComponent(slug)}`).then(
      (d) => { if (!cancelled) setDetail(d); },
      (err) => { if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err)); },
    );
    return () => { cancelled = true; };
  }, [api, slug]);

  const loaded = detail !== null;
  const autoOn = detail?.auto?.on === true;
  useEffect(() => {
    if (!loaded) return;
    (nameBox.current ?? closeBox.current?.querySelector<HTMLButtonElement>('button'))?.focus();
  }, [loaded]);

  const current = detail?.drive?.model ?? null;
  const target = picked ?? models.find((m) => m.id !== current)?.id ?? null;
  const label = models.find((m) => m.id === target)?.label ?? target ?? '';
  // m7: the live run first (it starts and ends while the sheet is open), else the job's as fetched.
  const running = isActiveRun(runs[slug] ?? detail?.run);
  const sameModel = target !== null && target === current;
  const ready = detail !== null && !running && !sameModel && target !== null && name.trim() === slug;

  async function restart() {
    if (!ready || target === null) return;
    setBusy(true);
    setError(null);
    try {
      setDone(await api.post<Restarted>(`/api/job/${encodeURIComponent(slug)}/restart`, { model: target }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
  }

  if (done) {
    return (
      <Sheet title="The job started again" onClose={onClose} className="close-sheet">
        <p className="sheet-lede">The job is running again on {label}. Nothing was deleted. Where its old work is now:</p>
        <ul className="sheet-list">
          <li>Spec, plan, briefs and decisions: <code className="num">{done.archive}</code></li>
          {done.backupBranch && <li>Commits, on the backup branch: <code className="num">{done.backupBranch}</code></li>}
          {done.worktreeAside && <li>The old worktree folder, with any uncommitted changes: <code className="num">{done.worktreeAside}</code></li>}
        </ul>
        {(done.notes ?? []).length > 0 && <ul className="sheet-list">{(done.notes ?? []).map((n) => <li key={n}>{n}</li>)}</ul>}
        <div className="sheet-actions">
          <Button kind="primary" onClick={() => { navigate({ name: 'job', slug: done.slug }); onClose(); }} title="Open the job that started again.">Open the job</Button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title="Change the Foreman model" onClose={onClose} busy={busy} className="close-sheet">
      {loadError && <p className="field-problem" role="alert">{loadError}</p>}
      {!detail && !loadError && <p className="muted" role="status">Loading…</p>}
      {detail && hasPullRequest(detail.prs) && (
        <>
          <p className="sheet-lede">{PR_REASON}</p>
          <div className="sheet-actions" ref={closeBox}><Button onClick={onClose} title="Leave the job as it is.">Close</Button></div>
        </>
      )}
      {detail && !hasPullRequest(detail.prs) && (
        <form onSubmit={(e) => { e.preventDefault(); void restart(); }}>
          <ul className="sheet-list change-model-first">{CONSEQUENCES.map((c) => <li key={c}>{c}</li>)}</ul>
          {autoOn && <p className="sheet-lede">{AUTO_RESTART}</p>}
          <details className="fold change-model-more">
            <summary className="fold-head" title="Everything else a restart moves or keeps, and what it checks first.">
              <span className="fold-name">What else moves, and what is kept</span><FoldShow />
            </summary>
            <ul className="sheet-list fold-body">{[...(autoOn ? [] : [AUTO_RESTART]), ...MORE_CONSEQUENCES].map((c) => <li key={c}>{c}</li>)}</ul>
          </details>
          <Field label="Foreman model">
            <Select value={target ?? ''} onChange={setPicked} disabled={busy || models.length === 0} options={models.map((m) => ({ value: m.id, label: m.id === current ? `${m.label} (now)` : m.label }))} />
          </Field>
          <Field label={<>Type the job's name, <code>{slug}</code>, to confirm</>}>
            <TextInput ref={nameBox} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" spellCheck={false} disabled={busy} aria-label="Type the job's name to confirm" title={`Type ${slug} exactly. This makes sure you mean to start the job again.`} />
          </Field>
          {running && <p className="field-problem" role="alert">Stop the reply first.</p>}
          {error && <p className="field-problem" role="alert">{error}</p>}
          <div className="sheet-actions">
            <Button onClick={onClose} disabled={busy} title="Leave the job as it is.">Cancel</Button>
            <Button
              type="submit"
              kind="danger"
              busy={busy}
              busyLabel="Starting again…"
              disabled={!ready}
              title={running ? 'The Foreman is replying. Stop the reply first.' : sameModel ? 'Pick a different model first.' : name.trim() !== slug ? 'Type the job\'s name above first.' : 'Move the job\'s work to the archive and start the job again on this model.'}
            >
              Start the job again on {label}
            </Button>
          </div>
        </form>
      )}
    </Sheet>
  );
}
