// Achievements (#/achievements, Play mode only; from the Crew-dex's count or ⌘K "Achievements"):
// the ten visible achievements as badges, each with its name, how to get it and when you got it,
// or "Locked" (in words, never colour alone). Secret ones (the easter eggs) appear only once
// found, with their name and date; the rest are only counted ("3 more secrets to find"), with no
// hints. Below, the hidden themes: Gold with its progress, CRT Terminal only once found. All from
// GET /api/play: personal, local, and never from approving anything.
import type { Achievement, PlayView } from '../../api/types';
import { crewDexHref, settingsHref } from '../../app/router';
import { HowThisWorks } from '../../components/HowThisWorks';
import { fullTime } from '../../lib/time';
import { AchievementBadge } from '../../play/AchievementBadge';
import { usePlayLedger } from '../../play/usePlayLedger';
import { MEDAL_SIZE } from '../../play/crewSizes';

/** Quests done that unlock the Gold theme (dashboard/lib/play.js GOLD_QUESTS). */
export const GOLD_QUESTS = 10;

/** "Oct 16, 2026". */
export function unlockDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { dateStyle: 'medium' });
}

function Badge({ a }: { a: Achievement }) {
  const got = Boolean(a.unlockedAt);
  return (
    <li className={`ach-badge ${got ? 'is-unlocked' : 'is-locked'}`} data-achievement={a.id}>
      <AchievementBadge id={a.id} unlocked={got} size={MEDAL_SIZE.list} />
      <div className="ach-text">
        <h3 className="ach-name">{a.name}</h3>
        <p className="ach-how">{a.howTo}</p>
        {got ? (
          <p className="ach-state is-unlocked" title={fullTime(a.unlockedAt)}>Unlocked {unlockDate(a.unlockedAt!)}</p>
        ) : (
          <p className="ach-state is-locked">Locked</p>
        )}
      </div>
    </li>
  );
}

function Secrets({ view }: { view: PlayView }) {
  const found = view.achievements.filter((a) => a.secret && a.unlockedAt);
  const left = Math.max(0, view.secrets.total - view.secrets.found.length);
  return (
    <section className="ach-secrets" aria-labelledby="ach-secrets-title">
      <h3 id="ach-secrets-title" className="settings-heading">Secrets <span className="num muted">{view.secrets.found.length}/{view.secrets.total}</span></h3>
      {found.length > 0 && (
        <ul className="ach-grid ach-secret-list">
          {found.map((a) => (
            <li key={a.id} className="ach-badge is-unlocked is-secret" data-achievement={a.id}>
              <AchievementBadge id={a.id} size={MEDAL_SIZE.list} />
              <div className="ach-text">
                <h4 className="ach-name">{a.name}</h4>
                <p className="ach-state is-unlocked" title={fullTime(a.unlockedAt)}>Found {unlockDate(a.unlockedAt!)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="ach-secrets-left">{left === 0 ? 'Every secret found.' : `${left} more secret${left === 1 ? '' : 's'} to find.`}</p>
    </section>
  );
}

function Unlocks({ view }: { view: PlayView }) {
  const done = Math.min(view.quests.done, GOLD_QUESTS);
  return (
    <section className="ach-unlocks" aria-labelledby="ach-unlocks-title">
      <h3 id="ach-unlocks-title" className="settings-heading">Hidden themes</h3>
      <ul className="ach-unlock-list">
        <li className={view.unlocks.gold ? 'is-unlocked' : 'is-locked'}>
          <strong>Gold</strong>{' '}
          {view.unlocks.gold ? (
            <span>Unlocked: pick it under <a href={settingsHref()}>Settings → Theme</a>.</span>
          ) : (
            <span>Locked. Finish {GOLD_QUESTS} quests: <span className="num">{done}/{GOLD_QUESTS}</span> so far.</span>
          )}
        </li>
        {view.unlocks.crt && (
          <li className="is-unlocked">
            <strong>CRT Terminal</strong> <span>Unlocked: pick it under <a href={settingsHref()}>Settings → Theme</a>.</span>
          </li>
        )}
      </ul>
    </section>
  );
}

export function AchievementsView() {
  const { load, retry } = usePlayLedger();
  const view = load.state === 'ready' ? load.view : null;
  const visible = view ? view.achievements.filter((a) => !a.secret) : [];
  const got = visible.filter((a) => a.unlockedAt).length;
  return (
    <main className="pane pane-foreman" data-pane="achievements" aria-label="Achievements">
      <div className="foreman-column achievements">
        <h2 className="pane-title">Achievements</h2>
        <HowThisWorks id="achievements">
          <p><strong>Achievements come from finished work</strong>: quests done (a job counts as done by your Settings → Play rule: its first PR is created, or you mark it done), clean reviews, the crew you have met. <strong>Approving something never earns anything</strong>, so the game never nudges anyone to click Approve.</p>
          <p>A few are <strong>secrets</strong>: they show here only once you find them, and the count says how many are left, not where. Some rewards also unlock a hidden theme.</p>
          <p>Everything is <strong>local and personal</strong>: worked out from what this dashboard already records on this computer, never shared, and Claude is never asked anything.</p>
        </HowThisWorks>
        {load.state === 'loading' && <p className="muted">Loading achievements…</p>}
        {load.state === 'error' && (
          <p className="thread-error" role="alert">
            Couldn’t load your achievements: {load.message}{' '}
            <button type="button" className="btn btn-quiet" onClick={retry} title="Ask the dashboard again.">Try again</button>
          </p>
        )}
        {view && (
          <>
            <p className="ach-summary">
              <span className="num">{got}/{visible.length}</span> unlocked
              {' · '}
              <a href={crewDexHref()} title="Back to the Crew-dex: every crew member and what they have done.">Crew-dex</a>
            </p>
            <ul className="ach-grid" aria-label="Achievements">
              {visible.map((a) => <Badge key={a.id} a={a} />)}
            </ul>
            <Secrets view={view} />
            <Unlocks view={view} />
          </>
        )}
      </div>
    </main>
  );
}
