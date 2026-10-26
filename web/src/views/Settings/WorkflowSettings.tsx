// Settings → Workflow: the finish line (what counts as a job being done: dashboard/lib/finish.js; the
// choices and their words come from the dashboard, meta.finishLines), then what a new job starts
// with: Screens (wireframes) and Clarify questions, each Auto / Always / Off. Saved on the dashboard
// (POST /api/settings { workflow }), so every browser agrees; follows changes made elsewhere (the
// 'settings' event). A job can change its own screens and clarify choice in its Notes and options.
import { useId, useState } from 'react';
import { DEFAULT_FINISH_LINE, type FinishLine, type Settings, WORKFLOW_CHOICES, type WorkflowChoice, type WorkflowSettings as Workflow } from '../../api/types';
import { HowThisWorks } from '../../components/HowThisWorks';
import { useWorkshop, useWorkshopState } from '../../state/store';

/** Only for a rail line before the dashboard has said its words (meta.finishLines is the source). */
const FALLBACK_LABELS: Record<FinishLine, string> = { 'pr1-open': 'PR #1 open', 'pr1-merged': 'PR #1 merged', staging: 'In staging', main: 'In main', marked: 'When I mark it done' };

/** The finish line's label, from the dashboard's list when it has arrived. */
export function finishLineLabel(line: FinishLine | undefined, lines: { id: string; label: string }[] | undefined): string {
  const id = line ?? DEFAULT_FINISH_LINE;
  return lines?.find((l) => l.id === id)?.label ?? FALLBACK_LABELS[id] ?? id;
}

const CHOICE_WORDS: Record<WorkflowChoice, string> = { auto: 'Auto', always: 'Always', off: 'Off' };

export const CHOICES: { id: 'wireframes' | 'clarify'; label: string; auto: string; hint: string }[] = [
  { id: 'wireframes', label: 'Screens (wireframes) for new jobs', auto: 'At L2 and L3, when the spec names a screen.', hint: 'Whether the crew draws the feature’s screens before the plan, for you to review. Always: every job that touches a screen. Off: never, unless you ask in the job.' },
  { id: 'clarify', label: 'Clarify questions for new jobs', auto: 'When the request leaves a product decision open.', hint: 'Whether the Foreman asks you a few questions, with the consequence of each answer, before the spec is drafted. Always: every job. Off: never; the spec writer decides alone.' },
];

export function WorkflowSettings() {
  const { api, store } = useWorkshop();
  const { meta } = useWorkshopState();
  const w: Workflow = { finishLine: DEFAULT_FINISH_LINE, wireframes: 'auto', clarify: 'auto', ...(meta?.settings?.workflow ?? {}) };
  const lines = meta?.finishLines;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  async function save(patch: Partial<Workflow>) {
    setBusy(true);
    setError(null);
    try { store.dispatch({ type: 'settings', settings: await api.post<Settings>('/api/settings', { workflow: patch }) }); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }

  return (
    <section className="workflow-settings" aria-label="Workflow" aria-busy={busy}>
      <h3 className="settings-heading">Workflow</h3>
      <HowThisWorks id="workflow-settings">
        <p>The <strong>finish line</strong> says what counts as a job being done, everywhere at once: the Done group and notification, the Play quest, the goal flag on each job’s trail. Marking a job done always counts. A job past the line but not in main yet sits in <strong>Shipping</strong>, where nothing asks you anything.</p>
        <p><strong>Screens</strong> and <strong>Clarify questions</strong> are what a new job starts with; its Notes and options can change them for that job. On Auto the workflow decides from the job’s level and what the request says.</p>
      </HowThisWorks>
      <fieldset className="rule-options finish-line" disabled={busy} data-setting="finish-line">
        <legend className="look-heading">Finish line</legend>
        {lines?.length ? lines.map((l) => (
          <label key={l.id} className={`rule-option${w.finishLine === l.id ? ' is-picked' : ''}`} title={l.hint}>
            <input type="radio" name={`${id}-finish`} value={l.id} checked={w.finishLine === l.id} onChange={() => void save({ finishLine: l.id })} />
            <span className="rule-option-body">
              <span className="rule-option-kind">{l.label}{l.id === DEFAULT_FINISH_LINE && <span className="chip">Default</span>}</span>
              <span className="muted">{l.hint}</span>
            </span>
          </label>
        )) : (
          <p className="muted" role="note">The dashboard didn’t send the finish line’s choices. Update it and start it again; until then it uses {finishLineLabel(w.finishLine, undefined)}.</p>
        )}
      </fieldset>
      {CHOICES.map((c) => (
        <fieldset key={c.id} className="workflow-choice" disabled={busy} data-setting={c.id} title={c.hint}>
          <legend className="look-heading">{c.label}</legend>
          <div className="home-seg" role="radiogroup" aria-label={c.label}>
            {WORKFLOW_CHOICES.map((v) => (
              <label key={v} className={`home-seg-btn${w[c.id] === v ? ' is-on' : ''}`}>
                <input className="sr-only" type="radio" name={`${id}-${c.id}`} value={v} checked={w[c.id] === v} onChange={() => void save(c.id === 'wireframes' ? { wireframes: v } : { clarify: v })} />
                {CHOICE_WORDS[v]}
              </label>
            ))}
          </div>
          <p className="muted settings-note-under">Auto: {c.auto}</p>
        </fieldset>
      ))}
      <fieldset className="workflow-choice" disabled={busy} data-setting="auto-level">
        <legend className="look-heading">Level</legend>
        <label className="check">
          <input type="checkbox" checked={w.autoLevel === true} onChange={(e) => void save({ autoLevel: e.currentTarget.checked })} />
          Choose the level for me
        </label>
        <p className="muted settings-note-under">The higher of the rules’ level and the Foreman’s wins, and it is never lowered. After each build the real changes are checked again and the level raised if a rule says so; the Foreman then stops before any PR. You are asked instead when L3 applies, the two differ by 2 or more, or the request is too short to judge.</p>
      </fieldset>
      {error && <p className="field-problem" role="alert">{error}</p>}
    </section>
  );
}
