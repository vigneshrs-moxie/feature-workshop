// Settings → People: everyone who has signed in (GET /api/people), with their role. The owner can
// make anyone else a manager or a member; there is one owner, the first sign-in with the site's
// owner address. Roles change nothing about whose jobs anyone sees: everyone sees only their own.
import { useCallback, useEffect, useState } from 'react';
import { Segmented } from '../../components/Choice';
import { relativeTime, useNow } from '../../lib/time';
import { useDelayedFlag } from '../../lib/useDelayedFlag';
import { HostedSettings } from './SettingsRail';
import { isSignedOut, words, type HostedProps } from './shared';
import type { PersonRow, Role } from './types';

export const ROLE_WORDS: Record<Role, string> = { owner: 'Owner', manager: 'Manager', member: 'Member' };
const CHOICES = [
  { value: 'manager' as const, label: 'Manager', title: 'Make them a manager.' },
  { value: 'member' as const, label: 'Member', title: 'Make them a member.' },
];

type Load = { state: 'loading' } | { state: 'ready'; people: PersonRow[] } | { state: 'error'; message: string };

export function PeoplePage({ api, onSignedOut, person }: HostedProps) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState<number | null>(null);
  const now = useNow(60_000);
  const slow = useDelayedFlag(load.state === 'loading');
  const owner = person.role === 'owner';
  const read = useCallback(async () => {
    try { setLoad({ state: 'ready', people: (await api.get<{ people: PersonRow[] }>('/api/people')).people }); } catch (err) {
      if (isSignedOut(err)) return onSignedOut();
      setLoad({ state: 'error', message: words(err) });
    }
  }, [api, onSignedOut]);
  useEffect(() => { void read(); }, [read]);

  async function setRole(p: PersonRow, role: 'manager' | 'member') {
    setProblem(null);
    setSaving(p.id);
    try { setLoad({ state: 'ready', people: (await api.post<{ people: PersonRow[] }>(`/api/people/${p.id}/role`, { role })).people }); } catch (err) {
      if (isSignedOut(err)) return onSignedOut();
      setProblem(`${p.name}’s role didn’t change: ${words(err)}`);
    } finally { setSaving(null); }
  }

  return (
    <HostedSettings at="people">
      <h3 className="settings-heading">People</h3>
      <p className="muted">Everyone who has signed in to the site. {owner ? 'As the owner you choose who is a manager.' : 'Only the owner changes roles.'} Roles don’t change whose jobs anyone sees: each person sees only their own.</p>
      {load.state === 'loading' && slow && <p className="muted" role="status">Loading people…</p>}
      {load.state === 'error' && <p className="field-problem" role="alert">Couldn’t load people: {load.message}</p>}
      {load.state === 'ready' && (
        <ul className="rule-list" aria-label="People">
          {load.people.map((p) => (
            <li key={p.id} className="rule-row hosted-person" data-person={p.email}>
              <div className="rule-row-main">
                <p className="rule-row-label"><strong>{p.name}</strong>{p.you && <span className="chip">You</span>}</p>
                <p className="rule-row-meta muted"><span>{p.email}</span>{p.lastSignInAt && <span>· Signed in {relativeTime(p.lastSignInAt, now)}</span>}</p>
              </div>
              <div className="doc-actions">
                {owner && p.role !== 'owner'
                  ? <Segmented label={`${p.name}’s role`} value={p.role as 'manager' | 'member'} options={CHOICES} disabled={saving !== null} onChange={(r) => void setRole(p, r)} />
                  : <span className="hosted-role">{ROLE_WORDS[p.role]}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {problem && <p className="field-problem" role="alert">{problem}</p>}
    </HostedSettings>
  );
}
