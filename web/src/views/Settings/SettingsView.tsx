// Settings: your permission setting (ask about everything, routine steps automatic, auto mode;
// POST /api/settings), and your "Always allow" rules (GET /api/rules), each removable. Both
// follow changes made elsewhere (the dashboard's 'settings' and 'rules' events). A warning shows
// when the installed /feature skill predates levels (meta.skill).
import { useEffect, useState } from 'react';
import type { PolicyId, Rule, RulesList, Settings } from '../../api/types';
import { jobHref } from '../../app/router';
import { HowThisWorks } from '../../components/HowThisWorks';
import { autoBlockedReason, autoModeOf, HARD_LINES_NOTE, POLICIES } from '../../components/permissions/policies';
import { sentence } from '../../components/permissions/rules';
import { fullTime, relativeTime, useNow } from '../../lib/time';
import { useWorkshop, useWorkshopState } from '../../state/store';
import { PlaySettings } from './PlaySettings';
import { NotifySettings } from './NotifySettings';
import { ThemePicker } from './ThemePicker';

type Load = { state: 'loading' } | { state: 'ready'; list: RulesList } | { state: 'error'; message: string };

function RuleRow({ rule, now, onRemoved }: { rule: Rule; now: Date; onRemoved: () => void }) {
  const { api } = useWorkshop();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api.del(`/api/rules/${encodeURIComponent(rule.id)}`);
      onRemoved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }
  return (
    <li className="rule-row">
      <div className="rule-row-main">
        <p className="rule-row-label">{sentence(rule.label)}</p>
        <p className="rule-row-meta muted">
          {rule.createdAt && <span title={fullTime(rule.createdAt)}>Saved {relativeTime(rule.createdAt, now)}{/^\d+[mhd]$/.test(relativeTime(rule.createdAt, now)) ? ' ago' : ''}</span>}
          {rule.from?.slug && (
            <span> · from <a href={jobHref(rule.from.slug)} title="Open the job this rule was saved from.">{rule.from.title || rule.from.slug}</a></span>
          )}
          <span className="chip num" title="The Claude Code tool this rule is for.">{rule.tool}</span>
        </p>
        {error && <p className="field-problem" role="alert">{error}</p>}
      </div>
      <button
        type="button"
        className="btn btn-quiet"
        disabled={busy}
        onClick={() => void remove()}
        aria-label={`Remove the rule: ${sentence(rule.label)}`}
        title="Remove this rule. Steps like this ask you again from now on, including in replies already running."
      >
        {busy ? 'Removing…' : 'Remove'}
      </button>
    </li>
  );
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The three-way permission setting. Auto mode is shown disabled, with the reason, when it isn't available. */
function PolicyChoice() {
  const { api, store } = useWorkshop();
  const { meta } = useWorkshopState();
  const settings = meta?.settings;
  const current: PolicyId = settings?.policy ?? 'hands-off';
  const auto = autoModeOf(settings);
  const blocked = autoBlockedReason(auto);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      store.dispatch({ type: 'settings', settings: await api.post<Settings>('/api/settings', body) });
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Permissions">
      <h3 className="settings-heading">Permissions</h3>
      <fieldset className="rule-options policy-options" disabled={busy}>
        <legend className="sr-only">How much the Foreman may do without asking you</legend>
        {POLICIES.map((p) => {
          const off = p.id === 'auto' && blocked !== null && current !== 'auto';
          return (
            <label key={p.id} className={`rule-option${current === p.id ? ' is-picked' : ''}${off ? ' is-off' : ''}`} title={off ? blocked ?? undefined : p.hint}>
              <input type="radio" name="policy" value={p.id} checked={current === p.id} disabled={off} onChange={() => void post({ policy: p.id })} />
              <span className="rule-option-body">
                <span className="rule-option-kind">{p.label}{p.id === 'hands-off' && <span className="chip">Default</span>}</span>
                <span className="muted">{p.note}</span>
                {p.id === 'auto' && blocked && <span className="perm-warn" role="note">Not available: {blocked}</span>}
              </span>
            </label>
          );
        })}
      </fieldset>
      {blocked && (
        <button type="button" className="btn btn-quiet policy-recheck" disabled={busy} onClick={() => void post({ recheckAuto: true })} title="Forget that auto mode wasn’t available, so you can pick it and the next reply tries it again.">
          Check again
        </button>
      )}
      <p className="muted policy-hard-lines">{HARD_LINES_NOTE} A job can have its own setting: use its job menu.</p>
      {error && <p className="field-problem" role="alert">{error}</p>}
    </section>
  );
}

export const STALE_SKILL = 'Your installed /feature skill predates levels. Run install.sh from claude-feature-workflow to update it; until then the Foreman treats L0 like L1 and ignores chip lines it doesn’t know.';

/** A warning when the installed /feature skill has no Levels table (meta.skill; the dashboard only reads it). */
function SkillWarning() {
  const { meta } = useWorkshopState();
  const skill = meta?.skill;
  if (!skill?.installed || skill.levels) return null;
  return (
    <p className="perm-warn skill-warning" role="note" title={`The dashboard read ${skill.path} (it never changes it) and found no Levels table.`}>
      {STALE_SKILL}
    </p>
  );
}

export function SettingsView() {
  const { api } = useWorkshop();
  const { rulesVersion, meta } = useWorkshopState();
  const policy = meta?.settings?.policy; // the rules wait while "ask about everything" is on: refetch when it changes
  const now = useNow();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [mine, setMine] = useState(0); // bumped after a removal here, to refetch

  useEffect(() => {
    let cancelled = false;
    api.get<RulesList>('/api/rules').then(
      (list) => { if (!cancelled) setLoad({ state: 'ready', list }); },
      (err) => { if (!cancelled) setLoad({ state: 'error', message: err instanceof Error ? err.message : String(err) }); },
    );
    return () => { cancelled = true; };
  }, [api, rulesVersion, mine, policy]);

  return (
    <main className="pane pane-foreman" data-pane="settings" aria-label="Settings">
      <div className="foreman-column settings">
        <h2 className="pane-title">Settings</h2>
        <HowThisWorks id="settings">
          <p><strong>Permissions</strong> decide how much the Foreman and its crew may do without asking you. <strong>Routine steps automatic</strong> is the default. <strong>Auto mode</strong> lets Claude Code’s own safety model judge each step; what it blocks is listed in the conversation as a dim line, so nothing is hidden. A change applies at once, also to replies already running. {HARD_LINES_NOTE}</p>
          <p>When a permission card asks you about a step, <strong>Always allow…</strong> saves a rule so steps exactly like it run without asking. Each rule covers only what it says: one exact command, commands starting with the same words, one file, one folder, one website or one connection tool. Anything else still asks.</p>
          <p>Rules apply to every job the dashboard runs, and only there: they aren’t added to your Claude Code settings, so your terminal sessions are unaffected. They’re not used while “ask about everything” is on, or for steps Claude Code flags as risky. Remove a rule here and those steps ask again.</p>
          <p><strong>Notifications</strong> come from the dashboard itself to macOS, so they reach you with this tab closed: what needs you, problems, and jobs reaching staging or main. Each kind with a sound, silent or off, plus quiet hours.</p>
          <p><strong>Theme</strong> changes how the Workshop looks and nothing else; it’s remembered in this browser.</p>
          <p><strong>Play</strong> turns the workshop crew, achievements and secrets on or off (Subtle by default). It has its own explanation below.</p>
          <p>If your installed <code>/feature</code> skill is older than the dashboard (it doesn’t know levels yet), a warning shows at the top of this page with how to update it.</p>
        </HowThisWorks>
        <SkillWarning />
        <PolicyChoice />
        <NotifySettings />
        <section aria-label="Always allow rules">
          <h3 className="settings-heading">Always allow rules</h3>
          {load.state === 'loading' && <p className="muted">Loading your rules…</p>}
          {load.state === 'error' && <p className="thread-error" role="alert">Couldn’t load your rules: {load.message}</p>}
          {load.state === 'ready' && (
            <>
              {load.list.unreadable && (
                <p className="perm-warn" role="alert">The rules file {load.list.unreadable} can’t be read, so no rule is used and new ones can’t be saved. Fix or remove that file.</p>
              )}
              {!load.list.active && (
                <p className="perm-warn" role="note">“Ask about everything” is on, so these rules wait: every step asks you until you pick “Routine steps automatic” or “Auto mode” above.{load.list.jobOverrides ? ` Jobs with their own setting (${load.list.jobOverrides}) follow that instead.` : ''}</p>
              )}
              {load.list.active && !!load.list.jobOverrides && (
                <p className="muted" role="note">These rules aren’t used for {load.list.jobOverrides === 1 ? 'the 1 job' : `the ${load.list.jobOverrides} jobs`} set to “Ask about everything” on their own.</p>
              )}
              {load.list.rules.length === 0 ? (
                <p className="muted">No rules yet. Use <strong>Always allow…</strong> on a permission card to add one.</p>
              ) : (
                <ul className="rule-list">
                  {load.list.rules.map((r) => <RuleRow key={r.id} rule={r} now={now} onRemoved={() => setMine((n) => n + 1)} />)}
                </ul>
              )}
            </>
          )}
        </section>
        <ThemePicker />
        <PlaySettings />
      </div>
    </main>
  );
}
