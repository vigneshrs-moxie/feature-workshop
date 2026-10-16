// The job drawer's Options tab: the job's options.json in full, replacing the classic Options page.
// Level (with what moving there adds or drops), stages to skip, reviewers, fix rounds, testing it
// yourself, Fable second looks, models, the documents provided (read only here) and process notes.
// Save posts the whole options (POST /api/job/:slug/options { options }) and shows the dashboard's
// summary of what it saved; the dashboard's refusals show inline. Options choose process, never
// permission, and apply from the next stage.
import { useEffect, useId, useRef, useState } from 'react';
import type { JobDetail, LevelNumber } from '../../api/types';
import { saveJobOptions } from '../../app/jobActions';
import { classicHref } from '../../app/router';
import { bodyFrom, formFrom, levelDefaults, MODEL_ROLES, optionLists, PROCESS_NOTES_MAX, providedSkips, sameOptions, inOrder, type ModelRole, type OptionsForm } from '../../lib/jobOptions';
import { isLevel, LEVEL_NUMBERS, levelChange, levelLabel, lensNames } from '../../lib/levels';
import { useWorkshop, useWorkshopState } from '../../state/store';

export const OPTIONS_HINT = 'Options choose how much process this job gets, never what it may do without asking (that is the permission setting). A change applies from the next stage; a worker already running finishes first.';

const ROLE_LABELS: Record<ModelRole, { label: string; hint: string }> = {
  foreman: { label: 'Foreman', hint: 'The model the Foreman itself runs on: it plans, dispatches the crew and writes your briefs. Used from its next session.' },
  build: { label: 'Build', hint: 'The model the builder (feature-implementer) uses to change the code.' },
  checks: { label: 'Checks', hint: 'The model the tester uses to run the checks and the approved test plan.' },
};

const STAGE_HINTS: Record<string, string> = {
  spec: 'The written product spec.',
  refine: 'A short product interview to settle open questions in the spec.',
  investigate: 'A read-only look through the code before planning.',
  'spec-update': 'Updating the spec with what the investigation found.',
  plan: 'The written implementation plan. Skipping it never skips approval: a quick plan still comes to you.',
  test: 'The crew’s own checks after the build.',
  review: 'The review lenses after the build.',
};

type Load = { state: 'loading' } | { state: 'ready' } | { state: 'error'; message: string };
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const toggle = (list: string[], id: string, on: boolean) => (on ? [...new Set([...list, id])] : list.filter((x) => x !== id));

export function OptionsEditor({ slug, level: jobLevel, onDirtyChange }: { slug: string; level: LevelNumber | null; onDirtyChange: (dirty: boolean) => void }) {
  const { api } = useWorkshop();
  const state = useWorkshopState();
  const meta = state.meta;
  const levels = meta?.levels;
  const names = lensNames(meta);
  const lists = optionLists(meta);
  const id = useId();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [saved, setSaved] = useState<OptionsForm | null>(null);
  const [form, setForm] = useState<OptionsForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string[] | null>(null);
  const [tries, setTries] = useState(0);

  const dirty = !!form && !!saved && !sameOptions(form, saved);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

  // Load the job's options; again when the job changes elsewhere (a gate chip, the level chip),
  // unless you're in the middle of editing them.
  const version = state.threadVersions[slug] ?? 0;
  const editing = useRef(false);
  editing.current = dirty || busy;
  useEffect(() => {
    if (editing.current && load.state === 'ready') return;
    let cancelled = false;
    api.get<JobDetail>(`/api/job/${encodeURIComponent(slug)}`).then(
      (detail) => {
        if (cancelled || editing.current) return;
        const f = formFrom(detail?.options ?? null, isLevel(detail?.level) ? detail.level : jobLevel, levels, lists);
        setSaved(f);
        setForm(f);
        setLoad({ state: 'ready' });
      },
      (err) => { if (!cancelled) setLoad({ state: 'error', message: message(err) }); },
    );
    return () => { cancelled = true; };
    // lists and levels come from meta, which only changes on a resync; the job's version drives it.
  }, [api, slug, version, tries]);

  if (load.state === 'loading' || !form || !saved) {
    if (load.state === 'error') {
      return (
        <div>
          <p className="thread-error" role="alert">Couldn’t load the options: {load.message}</p>
          <button type="button" className="btn" onClick={() => setTries((n) => n + 1)} title="Ask the dashboard for this job’s options again.">Try again</button>
        </div>
      );
    }
    return <p className="muted" role="status">Loading the options…</p>;
  }

  const edit = (patch: Partial<OptionsForm>) => { setForm({ ...form, ...patch }); setError(null); setSummary(null); };
  const pickLevel = (n: LevelNumber) => edit(levelDefaults(n, levels, lists, { provided: form.provided, notes: form.notes, review_rounds: form.review_rounds }));
  const resetToLevel = () => edit(levelDefaults(form.level, levels, lists, { provided: form.provided, notes: form.notes, review_rounds: 1 }));
  const lockedSkips = providedSkips(form.provided, lists);
  const lenses = form.reviewers === 'auto' ? [] : form.reviewers;
  const noLenses = form.reviewers !== 'auto' && lenses.length === 0;
  const reviewSkipped = form.skip.includes('review') || noLenses;
  const change = form.level !== null && form.level !== saved.level ? levelChange(saved.level, form.level, levels, names) : null;
  const providedList = lists.providable.filter((d) => form.provided[d.id]);

  async function save() {
    if (!form) return;
    setBusy(true);
    setError(null);
    setSummary(null);
    try {
      const r = await saveJobOptions(api, slug, bodyFrom(form));
      const f = formFrom(r.options, form.level, levels, lists);
      setSaved(f);
      setForm(f);
      setSummary(Array.isArray(r.summary) ? r.summary : []);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="drawer-options">
      <p className="muted drawer-hint">{OPTIONS_HINT}</p>

      <fieldset className="drawer-section" disabled={busy}>
        <legend className="drawer-legend" title="How much process the job gets. Picking a level here sets its stages, reviewers, testing, Fable points and models below; change any of them after.">Level</legend>
        <div className="rule-options" role="radiogroup" aria-label="Level">
          {LEVEL_NUMBERS.map((n) => {
            const info = levels?.find((l) => l.level === n);
            return (
              <label key={n} className={`rule-option${form.level === n ? ' is-picked' : ''}`} title={`${levelLabel(n, levels)}: ${info?.hint ?? ''}${saved.level !== n ? ` ${levelChange(saved.level, n, levels, names).text}.` : ' The level saved now.'}`}>
                <input type="radio" name={`${id}-level`} value={n} checked={form.level === n} onChange={() => pickLevel(n)} />
                <span className="rule-option-body">
                  <span className="rule-option-kind">{levelLabel(n, levels)}{saved.level === n && <span className="chip">Saved</span>}</span>
                  {info?.hint && <span className="muted">{info.hint}</span>}
                </span>
              </label>
            );
          })}
        </div>
        {form.level === null && <p className="muted drawer-fine">No level yet: the Foreman suggests one in its first brief. Pick one to set it now.</p>}
        {change && <p className="drawer-fine level-consequence" role="status">If you save: {change.text}.</p>}
      </fieldset>

      <fieldset className="drawer-section" disabled={busy}>
        <legend className="drawer-legend" title="Stages this job leaves out. The level’s own choice is ticked; change it for this job.">Stages to skip</legend>
        <div className="drawer-checks">
          {lists.skippable.map((s) => {
            const locked = lockedSkips.includes(s.id);
            return (
              <label key={s.id} className="check drawer-check" title={locked ? 'You provided this document, so the crew doesn’t write it. Change provided documents in the classic view.' : `Skip ${s.label} for this job. ${STAGE_HINTS[s.id] ?? ''}`}>
                <input type="checkbox" checked={form.skip.includes(s.id) || locked} disabled={locked} onChange={(e) => edit({ skip: inOrder(toggle(form.skip, s.id, e.target.checked), lists) })} />
                <span>{s.label}{locked && <span className="muted"> (document provided)</span>}</span>
              </label>
            );
          })}
        </div>
        <p className="muted drawer-fine">Skipping a stage never skips an approval: every plan still comes to you before anyone acts on it.</p>
      </fieldset>

      <fieldset className="drawer-section" disabled={busy || form.skip.includes('review')}>
        <legend className="drawer-legend" title="Which review lenses look at the change after it is built.">Reviewers</legend>
        <div className="seg">
          <label className={`seg-option${form.reviewers === 'auto' ? ' is-picked' : ''}`} title="The Foreman picks the usual lenses for this kind of change (the head inspector, permissions and tests, plus database or screens when touched).">
            <input type="radio" name={`${id}-rev`} checked={form.reviewers === 'auto'} onChange={() => edit({ reviewers: 'auto' })} /> Auto
          </label>
          <label className={`seg-option${form.reviewers !== 'auto' ? ' is-picked' : ''}`} title="Exactly the lenses you tick below, no others.">
            <input type="radio" name={`${id}-rev`} checked={form.reviewers !== 'auto'} onChange={() => edit({ reviewers: lenses.length ? lenses : ['feature-reviewer'] })} /> Pick them
          </label>
        </div>
        <div className="drawer-checks">
          {lists.reviewers.map((r) => (
            <label key={r.id} className={`check drawer-check${form.reviewers === 'auto' ? ' is-off' : ''}`} title={`${r.label}: checks ${r.what ?? 'its own area'}${r.model ? ` (runs on ${r.model})` : ''}.${form.reviewers === 'auto' ? ' Choose “Pick them” to tick lenses yourself.' : ''}`}>
              <input type="checkbox" checked={form.reviewers === 'auto' ? false : lenses.includes(r.id)} disabled={form.reviewers === 'auto'} onChange={(e) => edit({ reviewers: toggle(lenses, r.id, e.target.checked) })} />
              <span><strong>{r.label}</strong>{r.what ? <span className="muted"> — {r.what}</span> : null}</span>
            </label>
          ))}
        </div>
        {form.skip.includes('review') && <p className="muted drawer-fine">The review stage is skipped, so no lenses run.</p>}
        {!form.skip.includes('review') && noLenses && <p className="perm-warn drawer-fine">No lenses ticked: the review stage is skipped.</p>}
      </fieldset>

      <fieldset className="drawer-section" disabled={busy || reviewSkipped}>
        <legend className="drawer-legend" title="How many times the crew may fix what the review found before it comes back to you.">Fix rounds after review</legend>
        <div className="seg">
          {([1, 2, 3] as const).map((n) => (
            <label key={n} className={`seg-option${form.review_rounds === n ? ' is-picked' : ''}`} title={`At most ${n} fix round${n === 1 ? '' : 's'}: the crew fixes the review’s findings and reviews again, up to ${n} time${n === 1 ? '' : 's'}, then briefs you.`}>
              <input type="radio" name={`${id}-rounds`} checked={form.review_rounds === n} onChange={() => edit({ review_rounds: n })} /> {n}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="drawer-section" disabled={busy}>
        <legend className="drawer-legend" title="Whether you try the change on your computer before review.">You test it</legend>
        <label className="check drawer-check" title="The Foreman waits for you to try the change on your computer (the classic view’s Try it locally) before the review.">
          <input type="checkbox" checked={form.manual_test} onChange={(e) => edit({ manual_test: e.target.checked })} />
          <span>I test it by hand before review</span>
        </label>
      </fieldset>

      <fieldset className="drawer-section" disabled={busy}>
        <legend className="drawer-legend" title="Points where Fable, the strongest and most expensive model, takes a short independent second look.">Fable second looks</legend>
        <div className="drawer-checks">
          {lists.fablePoints.map((p) => (
            <label key={p.id} className="check drawer-check" title={`Fable takes a short second look ${p.label.toLowerCase()}. It costs more and uses your limits faster.`}>
              <input type="checkbox" checked={form.fable_checks.includes(p.id)} onChange={(e) => edit({ fable_checks: lists.fablePoints.map((x) => x.id).filter((x) => (x === p.id ? e.target.checked : form.fable_checks.includes(x))) })} />
              <span>{p.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="drawer-section" disabled={busy}>
        <legend className="drawer-legend" title="Which Claude model each part of the job runs on.">Models</legend>
        <div className="drawer-models">
          {MODEL_ROLES.map((role) => {
            const choices = lists.models[role];
            const value = form.models[role];
            const shown = choices.some((c) => c.id === value) ? choices : [...choices, { id: value, label: value }];
            const note = shown.find((c) => c.id === value)?.note;
            return (
              <label key={role} className="drawer-model" title={`${ROLE_LABELS[role].hint}${note ? ` ${note}` : ''}`}>
                <span className="drawer-model-label">{ROLE_LABELS[role].label}</span>
                <select className="select" value={value} onChange={(e) => edit({ models: { ...form.models, [role]: e.target.value } })}>
                  {shown.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </label>
            );
          })}
        </div>
      </fieldset>

      <section className="drawer-section" aria-label="Documents you provided">
        <h4 className="drawer-legend" title="Documents you handed over instead of having the crew write them. Each one skips its stage.">Documents you provided</h4>
        {providedList.length ? (
          <ul className="drawer-provided">
            {providedList.map((d) => (
              <li key={d.id} title={`The crew uses this ${d.label.toLowerCase()} instead of writing one.`}>
                <span>{d.label}</span> <code className="num">{form.provided[d.id]}</code>
              </li>
            ))}
          </ul>
        ) : <p className="muted drawer-fine">None.</p>}
        <p className="muted drawer-fine">Adding or changing them stays in the classic view for now: <a href={classicHref.job(slug)} title="Open this job’s classic page; its Options button edits provided documents.">open this job in classic view</a>.</p>
      </section>

      <fieldset className="drawer-section" disabled={busy}>
        <legend className="drawer-legend" title="A few lines on how to run this job, sent with the options. For longer guidance use the Notes tab.">Process notes</legend>
        <label className="sr-only" htmlFor={`${id}-notes`}>Process notes</label>
        <textarea
          id={`${id}-notes`}
          className="text-area"
          rows={3}
          maxLength={PROCESS_NOTES_MAX}
          value={form.notes}
          onChange={(e) => edit({ notes: e.target.value })}
          placeholder="For example: “Skip the tester on doc-only steps.”"
          title={`A short note on process for the Foreman (at most ${PROCESS_NOTES_MAX.toLocaleString('en')} characters). It guides how the job runs; it never approves anything.`}
        />
        <p className="muted drawer-fine num">{form.notes.length.toLocaleString('en')} / {PROCESS_NOTES_MAX.toLocaleString('en')} characters</p>
      </fieldset>

      <div className="drawer-bar drawer-foot">
        {dirty && !busy && <span className="drawer-state" role="status">Unsaved changes</span>}
        <span className="composer-spacer" />
        <button
          type="button"
          className="btn btn-quiet"
          disabled={busy || form.level === null}
          onClick={resetToLevel}
          title={form.level === null ? 'Pick a level first.' : `Put stages, reviewers, fix rounds, testing, Fable points and models back to ${levelLabel(form.level, levels)}’s defaults. Provided documents and process notes stay. Nothing is saved until you choose Save.`}
        >
          Reset to level defaults
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!dirty || busy}
          onClick={() => void save()}
          title="Save these options for this job. The Foreman reads them before its next stage; a worker already running finishes first."
        >
          {busy ? 'Saving…' : 'Save options'}
        </button>
      </div>
      {error && <p className="field-problem" role="alert">{error}</p>}
      {summary && (
        <div className="drawer-summary" role="status">
          <p><strong>✓ Saved.</strong> The Foreman reads this from its next stage:</p>
          <ul>{summary.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
