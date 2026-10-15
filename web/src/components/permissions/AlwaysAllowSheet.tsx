// "Always allow…": draft, edit, confirm. The dashboard drafts the narrowest rule that covers the
// waiting request (picked first) and offers wider ones; you pick one, edit the wider ones if you
// like, then read back exactly what will be allowed before saving. Saving also allows the waiting
// request. Rules live in the dashboard's own list (rules.json), apply to every job it runs, and
// can be removed in Settings; nothing goes into your Claude Code settings.
import { useEffect, useId, useRef, useState } from 'react';
import type { Permission, Rule, RuleDraft } from '../../api/types';
import { settingsHref } from '../../app/router';
import { useWorkshop } from '../../state/store';
import { coverProblem, describeRule, editable, kindLabel, sentence } from './rules';

interface Saved { rule: Rule; added: boolean; allowed: boolean; alsoAllowed: number; active: boolean }

export function AlwaysAllowSheet({ permission: p, draft, onClose }: { permission: Permission; draft: RuleDraft; onClose: () => void }) {
  const { api, store } = useWorkshop();
  const titleId = useId();
  const [step, setStep] = useState<'edit' | 'confirm'>('edit');
  const [choice, setChoice] = useState(0);
  const [values, setValues] = useState(() => draft.options.map((o) => o.value));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const option = draft.options[choice];
  const value = values[choice] ?? '';
  const problem = editable(draft.tool, option.kind) ? coverProblem(draft.tool, option.kind, value, p.input) : null;
  const summary = describeRule(draft.tool, option.kind, value.trim());

  useEffect(() => {
    box.current?.querySelector<HTMLElement>('input, button')?.focus();
  }, [step]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.post<Saved>('/api/rules', { rule: { tool: draft.tool, kind: option.kind, value: value.trim() }, permissionId: p.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
      return;
    }
    store.dispatch({ type: 'permission-answered', id: p.id });
    onClose();
  }

  return (
    <div className="sheet-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={box}>
        <h3 id={titleId} className="sheet-title">Always allow</h3>
        {step === 'edit' ? (
          <>
            <p className="muted">Pick how much the rule covers. The first choice is the narrowest: it covers only what’s waiting now. Wider choices can be edited.</p>
            <fieldset className="rule-options">
              <legend className="sr-only">What the rule covers</legend>
              {draft.options.map((o, i) => (
                <label key={`${o.kind}:${i}`} className={`rule-option${i === choice ? ' is-picked' : ''}`}>
                  <input
                    type="radio"
                    name="rule-choice"
                    checked={i === choice}
                    onChange={() => setChoice(i)}
                    title={i === 0 ? 'The narrowest rule: only what is waiting now.' : 'A wider rule: also covers similar steps.'}
                  />
                  <span className="rule-option-body">
                    <span className="rule-option-kind">{kindLabel(draft.tool, o.kind)}{i === 0 ? <span className="chip">Narrowest</span> : null}</span>
                    {i === choice && editable(draft.tool, o.kind) ? (
                      <input
                        type="text"
                        className="text-input num"
                        value={values[i]}
                        onChange={(e) => setValues((vs) => vs.map((v, k) => (k === i ? e.target.value : v)))}
                        aria-label="What the rule covers"
                        title="Edit this to make the rule narrower or wider. It must still cover the request that’s waiting."
                        spellCheck={false}
                      />
                    ) : (
                      o.value ? <code className="rule-option-value">{o.value}</code> : null
                    )}
                  </span>
                </label>
              ))}
            </fieldset>
            {problem && <p className="field-problem" role="alert">{problem}</p>}
            <div className="sheet-actions">
              <button type="button" className="btn btn-primary" disabled={Boolean(problem)} onClick={() => setStep('confirm')} title="Check the rule once more before saving it.">Next</button>
              <button type="button" className="btn btn-quiet" onClick={onClose} title="Close this without saving a rule. The request keeps waiting.">Cancel</button>
            </div>
          </>
        ) : (
          <>
            <p>From now on, in <strong>every job the dashboard runs</strong>, the Foreman and its crew may <strong>{summary}</strong> without asking you.</p>
            <ul className="sheet-facts muted">
              <li>It also allows the request that’s waiting now.</li>
              <li>It never covers anything else: other commands, files or sites still ask.</li>
              <li>It isn’t used for a job set to “ask about everything” (by your setting or the job’s own), or for steps Claude Code flags as risky.</li>
              <li>You can remove it any time in <a href={settingsHref()} title="Open Settings, where your saved rules are listed and can be removed.">Settings</a>. Your Claude Code settings aren’t changed.</li>
            </ul>
            {error && <p className="field-problem" role="alert">{error}</p>}
            <div className="sheet-actions">
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()} title={`Save the rule “${sentence(summary)}” and allow the waiting request.`}>
                {busy ? 'Saving…' : 'Save rule and allow'}
              </button>
              <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => { setError(null); setStep('edit'); }} title="Go back and change the rule.">Back</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
