// Settings: a rail of sections on the left (Permissions · Notifications · Look · Keys · Workflow ·
// Play · Rules, each row with its current value in one muted line), the chosen section on the right,
// one at a time. #/settings opens the first; #/settings/<section> a given one (app/router.ts). Above
// the rail, "Find a setting" searches every control by label (sections.ts SETTING_INDEX): picking a
// match opens its section and rings the control for a moment. Keys (scope 'settings', through the
// registry): j and k move between sections, / goes to the search box.
//
// What each section saves is unchanged: server settings through POST /api/settings (permissions,
// notifications, workflow, Play), the "Always allow" rules through /api/rules, and browser-local
// settings (theme, text size, keys, this browser's alerts) through lib/stored.ts.
import { useEffect, useRef, useState } from 'react';
import type { PolicyId, Rule, RulesList, Settings } from '../../api/types';
import { useKeyScope } from '../../app/keyRegistry';
import { useKeysSetting } from '../../app/keysSetting';
import { jobHref, navigate, SETTINGS_SECTIONS, settingsHref, type SettingsSection } from '../../app/router';
import { HowThisWorks } from '../../components/HowThisWorks';
import { Kbd, KeyLegend } from '../../components/Kbd';
import { autoBlockedReason, autoModeOf, HARD_LINES_NOTE, POLICIES } from '../../components/permissions/policies';
import { sentence } from '../../components/permissions/rules';
import { readStored, useStored } from '../../lib/stored';
import { fullTime, relativeTime, useNow } from '../../lib/time';
import { useWorkshop, useWorkshopState } from '../../state/store';
import { DEFAULT_THEME, THEME_KEY } from '../../theme/theme';
import { useTextSize } from '../../theme/textSize';
import { PlaySettings } from './PlaySettings';
import { NotifySettings } from './NotifySettings';
import { LookSettings } from './LookSettings';
import { KeysSettings } from './KeysSettings';
import { WorkflowSettings } from './WorkflowSettings';
import { OrbitTokenSettings } from './OrbitTokenSettings';
import { FIRST_SECTION, findSettings, SECTION_WORDS, stepSection, valueLines, type SettingEntry } from './sections';

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
      <HowThisWorks id="settings">
        <p><strong>Permissions</strong> decide how much the Foreman and its crew may do without asking you. <strong>Routine steps automatic</strong> is the default. <strong>Auto mode</strong> lets Claude Code’s own safety model judge each step; what it blocks is listed in the conversation as a dim line, so nothing is hidden. A change applies at once, also to replies already running. {HARD_LINES_NOTE}</p>
        <p>When a permission card asks you about a step, <strong>Always allow…</strong> saves a rule so steps exactly like it run without asking; the rules are listed under <strong>Rules</strong>.</p>
        <p>If your installed <code>/feature</code> skill is older than the dashboard (it doesn’t know levels yet), a warning shows here with how to update it.</p>
      </HowThisWorks>
      <SkillWarning />
      <fieldset className="rule-options policy-options" disabled={busy} data-setting="policy">
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

/** Settings → Rules: your "Always allow" rules, each removable. */
function RulesSettings({ load, onRemoved }: { load: Load; onRemoved: () => void }) {
  const now = useNow();
  return (
    <section aria-label="Always allow rules" data-setting="rules">
      <h3 className="settings-heading">Always allow rules</h3>
      <HowThisWorks id="settings-rules">
        <p>When a permission card asks you about a step, <strong>Always allow…</strong> saves a rule so steps exactly like it run without asking. Each rule covers only what it says: one exact command, commands starting with the same words, one file, one folder, one website or one connection tool. Anything else still asks.</p>
        <p>Rules apply to every job the dashboard runs, and only there: they aren’t added to your Claude Code settings, so your terminal sessions are unaffected. They’re not used while “ask about everything” is on, or for steps Claude Code flags as risky. Remove a rule here and those steps ask again.</p>
      </HowThisWorks>
      {load.state === 'loading' && <p className="muted">Loading your rules…</p>}
      {load.state === 'error' && <p className="thread-error" role="alert">Couldn’t load your rules: {load.message}</p>}
      {load.state === 'ready' && (
        <>
          {load.list.unreadable && (
            <p className="perm-warn" role="alert">The rules file {load.list.unreadable} can’t be read, so no rule is used and new ones can’t be saved. Fix or remove that file.</p>
          )}
          {!load.list.active && (
            <p className="perm-warn" role="note">“Ask about everything” is on, so these rules wait: every step asks you until you pick “Routine steps automatic” or “Auto mode” under Permissions.{load.list.jobOverrides ? ` Jobs with their own setting (${load.list.jobOverrides}) follow that instead.` : ''}</p>
          )}
          {load.list.active && !!load.list.jobOverrides && (
            <p className="muted" role="note">These rules aren’t used for {load.list.jobOverrides === 1 ? 'the 1 job' : `the ${load.list.jobOverrides} jobs`} set to “Ask about everything” on their own.</p>
          )}
          {load.list.rules.length === 0 ? (
            <p className="muted">No rules yet. Use <strong>Always allow…</strong> on a permission card to add one.</p>
          ) : (
            <ul className="rule-list">
              {load.list.rules.map((r) => <RuleRow key={r.id} rule={r} now={now} onRemoved={onRemoved} />)}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/** How long a control found by the search keeps its ring. */
const FOUND_MS = 1800;

export function SettingsView({ section }: { section?: SettingsSection }) {
  const current: SettingsSection = section ?? FIRST_SECTION;
  const { api } = useWorkshop();
  const { rulesVersion, meta } = useWorkshopState();
  const policy = meta?.settings?.policy; // the rules wait while "ask about everything" is on: refetch when it changes
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

  // The rail's value lines.
  const [storedTheme] = useStored(THEME_KEY);
  const [textSize] = useTextSize();
  const [{ enabled: keysOn }] = useKeysSetting();
  const values = valueLines({
    settings: meta?.settings,
    finishLines: meta?.finishLines,
    theme: storedTheme ?? readStored(THEME_KEY) ?? DEFAULT_THEME,
    textSize,
    keysOn,
    rules: load.state === 'ready' ? (Array.isArray(load.list.rules) ? load.list.rules.length : 0) : load.state === 'error' ? 'error' : null,
  });

  // Find a setting: the matches replace the rail while you type; a pick opens the section and rings the control.
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const hits = findSettings(query);
  const go = (s: SettingsSection) => navigate({ name: 'settings', section: s });
  function jump(hit: SettingEntry) {
    setQuery('');
    search.current?.blur();
    go(hit.section);
    setFound(hit.id);
  }
  useEffect(() => {
    if (!found) return;
    const el = document.querySelector<HTMLElement>(`[data-setting="${found}"]`);
    if (!el) return; // the section is still on its way: this runs again when it has rendered
    el.classList.add('is-found');
    if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' });
    const t = setTimeout(() => { el.classList.remove('is-found'); setFound(null); }, FOUND_MS);
    return () => { clearTimeout(t); el.classList.remove('is-found'); };
  }, [found, current]);

  useKeyScope('settings', {
    'settings-next': () => go(stepSection(current, 1)),
    'settings-prev': () => go(stepSection(current, -1)),
    'settings-find': () => search.current?.focus(),
  });

  return (
    <main className="pane pane-foreman" data-pane="settings" aria-label="Settings">
      <div className="settings">
        <h2 className="pane-title">Settings</h2>
        <div className="settings-layout">
          <nav className="settings-rail" aria-label="Settings sections">
            <div className="settings-search">
              <input
                ref={search}
                type="search"
                className="settings-search-input"
                aria-label="Find a setting"
                placeholder="Find a setting"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && hits[0]) { e.preventDefault(); jump(hits[0]); }
                  if (e.key === 'Escape') { setQuery(''); e.currentTarget.blur(); }
                }}
              />
              <Kbd id="settings-find" />
            </div>
            {query.trim() ? (
              <ul className="settings-hits" aria-label="Matching settings">
                {hits.length ? hits.map((h) => (
                  <li key={h.id}>
                    <button type="button" className="settings-hit" onClick={() => jump(h)} title={`Open ${SECTION_WORDS[h.section].label} and show this setting.`}>
                      <span>{h.label}</span>
                      <span className="muted">{SECTION_WORDS[h.section].label}</span>
                    </button>
                  </li>
                )) : <li className="muted settings-hit-none">No setting matches “{query.trim()}”.</li>}
              </ul>
            ) : (
              <ul className="settings-rail-list">
                {SETTINGS_SECTIONS.map((s) => (
                  <li key={s}>
                    <a className={`settings-rail-row${s === current ? ' is-current' : ''}`} href={settingsHref(s)} aria-current={s === current ? 'page' : undefined} title={SECTION_WORDS[s].hint}>
                      <span className="settings-rail-name">{SECTION_WORDS[s].label}</span>
                      <span className="settings-rail-value muted" data-value>{values[s]}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
            <KeyLegend ids={['settings-next', 'settings-prev', 'settings-find']} />
          </nav>
          <div className="settings-section" data-section={current}>
            {current === 'permissions' && <PolicyChoice />}
            {current === 'notifications' && <NotifySettings />}
            {current === 'look' && <LookSettings />}
            {current === 'keys' && <KeysSettings />}
            {current === 'workflow' && <WorkflowSettings />}
            {current === 'workflow' && <OrbitTokenSettings />}
            {current === 'play' && <PlaySettings />}
            {current === 'rules' && <RulesSettings load={load} onRemoved={() => setMine((n) => n + 1)} />}
          </div>
        </div>
      </div>
    </main>
  );
}
