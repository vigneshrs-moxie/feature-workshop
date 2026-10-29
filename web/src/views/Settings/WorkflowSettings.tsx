// Settings → Workflow: the finish line (what counts as a job being done: dashboard/lib/finish.js; the
// choices and their words come from the dashboard, meta.finishLines), then what a new job starts
// with: Screens (wireframes) and Clarify questions, each Auto / Always / Off. Saved on the dashboard
// (POST /api/settings { workflow }), so every browser agrees; follows changes made elsewhere (the
// 'settings' event). A job can change its own screens and clarify choice in its Notes and options.
// Last, how many sections of stacks build at once across every stack (POST /api/stacks/cap; a
// stack's own number, on its page, can be lower).
// Review rounds (packet Q), next to the finish line: how often GitHub is checked while a job waits
// on a reviewer or its checks (1, 5, 10 or 30 minutes; POST /api/review/settings), and who reviews
// and merges each pull request, read from each repository's profile (GET /api/review routes).
import { useEffect, useId, useState } from 'react';
import { DEFAULT_FINISH_LINE, DEFAULT_SECTIONS_AT_ONCE, type FinishLine, MAX_SECTIONS_AT_ONCE, type Settings, WORKFLOW_CHOICES, type WorkflowChoice, type WorkflowSettings as Workflow } from '../../api/types';
import { HowThisWorks } from '../../components/HowThisWorks';
import { useWorkshop, useWorkshopState } from '../../state/store';
import { useReviewList } from '../Review/useReview';
import '../Review/review.css';
import { Choice } from '../../components/Choice';
import { NumberInput } from '../../components/Field';

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

  // Sections at once: typed into a box, saved once it is a whole number from 1 to 20.
  const atOnce = w.sectionsAtOnce ?? DEFAULT_SECTIONS_AT_ONCE;
  const [atOnceDraft, setAtOnceDraft] = useState(String(atOnce));
  useEffect(() => { setAtOnceDraft(String(atOnce)); }, [atOnce]);
  async function saveAtOnce(raw: string) {
    setAtOnceDraft(raw);
    const n = Number(raw);
    if (!raw.trim()) return;
    if (!Number.isInteger(n) || n < 1 || n > MAX_SECTIONS_AT_ONCE) { setError(`Sections at once must be a whole number from 1 to ${MAX_SECTIONS_AT_ONCE}.`); return; }
    if (n === atOnce) { setError(null); return; }
    setBusy(true);
    setError(null);
    try { store.dispatch({ type: 'settings', settings: (await api.post<{ settings: Settings }>('/api/stacks/cap', { cap: n })).settings }); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }

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
            <Choice type="radio" name={`${id}-finish`} value={l.id} checked={w.finishLine === l.id} onChange={() => void save({ finishLine: l.id })} />
            <span className="rule-option-body">
              <span className="rule-option-kind">{l.label}{l.id === DEFAULT_FINISH_LINE && <span className="chip">Default</span>}</span>
              <span className="muted">{l.hint}</span>
            </span>
          </label>
        )) : (
          <p className="muted" role="note">The dashboard didn’t send the finish line’s choices. Update it and start it again; until then it uses {finishLineLabel(w.finishLine, undefined)}.</p>
        )}
      </fieldset>
      <GithubEvery />
      <RouteTable />
      {CHOICES.map((c) => (
        <fieldset key={c.id} className="workflow-choice" disabled={busy} data-setting={c.id} title={c.hint}>
          <legend className="look-heading">{c.label}</legend>
          <div className="home-seg" role="radiogroup" aria-label={c.label}>
            {WORKFLOW_CHOICES.map((v) => (
              <label key={v} className={`home-seg-btn${w[c.id] === v ? ' is-on' : ''}`}>
                <Choice className="sr-only" type="radio" name={`${id}-${c.id}`} value={v} checked={w[c.id] === v} onChange={() => void save(c.id === 'wireframes' ? { wireframes: v } : { clarify: v })} />
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
          <Choice type="checkbox" checked={w.autoLevel === true} onChange={(e) => void save({ autoLevel: e.currentTarget.checked })} />
          Choose the level for me
        </label>
        <p className="muted settings-note-under">The higher of the rules’ level and the Foreman’s wins, and it is never lowered. After each build the real changes are checked again and the level raised if a rule says so; the Foreman then stops before any PR. You are asked instead when L3 applies, the two differ by 2 or more, or the request is too short to judge.</p>
      </fieldset>
      <fieldset className="workflow-choice" disabled={busy} data-setting="sections-at-once">
        <legend className="look-heading">Stacks</legend>
        <div className="check">
          <NumberInput value={atOnceDraft} min={1} max={MAX_SECTIONS_AT_ONCE} onChange={(v) => void saveAtOnce(v)} aria-label="Sections at once, across every stack" />
          <span>Sections at once, across every stack</span>
        </div>
        <p className="muted settings-note-under">How many sections of big jobs split into a stack are built side by side, counting every stack. A stack can set a lower number on its own page. The rest wait, and the page says why. Default {DEFAULT_SECTIONS_AT_ONCE}.</p>
      </fieldset>
      {error && <p className="field-problem" role="alert">{error}</p>}
    </section>
  );
}

/** How often GitHub is checked while a job waits: the choices, in minutes (lib/review-round.js GITHUB_EVERY_CHOICES). */
export const GITHUB_EVERY: readonly (1 | 5 | 10 | 30)[] = [1, 5, 10, 30];
export const GITHUB_EVERY_DEFAULT = 1;

/** "every 1 min" for the rail line. */
export const githubEveryLine = (settings: Settings | null | undefined) => `GitHub every ${settings?.review?.githubEveryMin ?? GITHUB_EVERY_DEFAULT} min`;

function GithubEvery() {
  const { api } = useWorkshop();
  const { meta } = useWorkshopState();
  const saved = meta?.settings?.review?.githubEveryMin ?? GITHUB_EVERY_DEFAULT;
  const [picked, setPicked] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  useEffect(() => { setPicked(null); }, [saved]);
  const now = picked ?? saved;
  async function pick(n: 1 | 5 | 10 | 30) {
    setPicked(n);
    setBusy(true);
    setError(null);
    try { await api.post('/api/review/settings', { githubEveryMin: n }); }
    catch (err) { setPicked(null); setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }
  return (
    <fieldset className="workflow-choice" disabled={busy} data-setting="github-every">
      <legend className="look-heading">How often to check GitHub while waiting</legend>
      <p className="muted settings-note-under">While a job waits on a reviewer, or on its checks after a push. The rest of the time GitHub is read every 10 minutes, and right after any push or reply.</p>
      <div className="home-seg" role="radiogroup" aria-label="How often to check GitHub while waiting">
        {GITHUB_EVERY.map((n) => (
          <label key={n} className={`home-seg-btn${now === n ? ' is-on' : ''}`}>
            <Choice className="sr-only" type="radio" name={`${id}-github`} value={n} checked={now === n} onChange={() => void pick(n)} />
            {now === n ? '✓ ' : ''}{n} min
          </label>
        ))}
      </div>
      <p className="muted settings-note-under">Default: {GITHUB_EVERY_DEFAULT} min. Each check reads every repository’s pull requests, read-only. Check now (u), in Jobs and on a job’s Ship stop, works any time.</p>
      {error && <p className="field-problem" role="alert">{error}</p>}
    </fieldset>
  );
}

function RouteTable() {
  const { list, error, loaded } = useReviewList();
  const routes = list?.routes ?? [];
  return (
    <section className="workflow-choice workflow-route" data-setting="pr-route" aria-labelledby="workflow-route-head">
      <h4 className="look-heading" id="workflow-route-head">Who reviews and merges each pull request</h4>
      <p className="muted settings-note-under">Read from each repository’s profile (its PR route). Review rounds use these names: “PR #2 is Raj’s”, “Waiting for Raj to merge”. Change them in the profile.</p>
      {!loaded && <p className="muted" role="status">Reading the profiles…</p>}
      {loaded && error && <p className="muted" role="note">Not shown here: {error}</p>}
      {loaded && !error && routes.length === 0 && <p className="muted" role="note">No repository in Settings → Repos has a profile yet. Add one there, and its route shows here.</p>}
      {routes.map((r) => (
        <div key={r.name} className="route-table-wrap">
          {routes.length > 1 && <p className="route-name"><b>{r.name}</b></p>}
          {!r.named && <p className="muted settings-note-under">{r.name}’s profile names no route, so nobody is named: you may merge, and merging always asks.</p>}
          <table className="route-table">
            <thead><tr><th scope="col">Pull request</th><th scope="col">From → into</th><th scope="col">Reviews</th><th scope="col">Merges</th></tr></thead>
            <tbody>
              {r.steps.map((s) => (
                <tr key={s.pr}>
                  <th scope="row" className="num">PR #{s.pr}</th>
                  <td>{[s.from, s.into].filter(Boolean).join(' → ') || '—'}</td>
                  <td>{s.reviews}</td>
                  <td>{s.merges}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}
