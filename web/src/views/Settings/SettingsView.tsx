// Settings: for now, your "Always allow" rules (GET /api/rules), each removable. Refetched when
// they change anywhere (the dashboard's 'rules' event), so another tab's change shows here too.
import { useEffect, useState } from 'react';
import type { Rule, RulesList } from '../../api/types';
import { classicHref, jobHref } from '../../app/router';
import { HowThisWorks } from '../../components/HowThisWorks';
import { sentence } from '../../components/permissions/rules';
import { fullTime, relativeTime, useNow } from '../../lib/time';
import { useWorkshop, useWorkshopState } from '../../state/store';

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

export function SettingsView() {
  const { api } = useWorkshop();
  const { rulesVersion } = useWorkshopState();
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
  }, [api, rulesVersion, mine]);

  return (
    <main className="pane pane-foreman" aria-label="Settings">
      <div className="foreman-column settings">
        <h2 className="pane-title">Settings</h2>
        <HowThisWorks id="settings">
          <p>When a permission card asks you about a step, <strong>Always allow…</strong> saves a rule so steps exactly like it run without asking. Each rule covers only what it says: one exact command, commands starting with the same words, one file, one folder, one website or one connection tool. Anything else still asks.</p>
          <p>Rules apply to every job the dashboard runs, and only there: they aren’t added to your Claude Code settings, so your terminal sessions are unaffected. They’re not used while “ask about everything” is on, or for steps Claude Code flags as risky. Remove a rule here and those steps ask again.</p>
        </HowThisWorks>
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
                <p className="perm-warn" role="note">“Ask about everything” is on, so these rules wait: every step asks you until you switch back to “Routine steps automatic” (in the <a href={classicHref.home()}>classic view</a> for now).</p>
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
      </div>
    </main>
  );
}
