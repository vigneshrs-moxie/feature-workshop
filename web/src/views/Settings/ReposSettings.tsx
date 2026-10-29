// Settings → Repos: the repositories Ground Control knows, and the profile each one follows (plan
// G31; lib/repos.js and lib/profile.js on the dashboard). A profile says how work is done in that
// repository: its ticket names and branches, where worktrees go, and how Try it runs the app (its
// folder, command, ports and the settings file copied in). A repository's own ground-control.md wins;
// otherwise Ground Control keeps the profile file you name here (Orbit's comes with it).
//   GET    /api/repos/registry          the list, each with its profile's state in words
//   POST   /api/repos/registry          add one: { path, profileFile? } (400 with each problem)
//   DELETE /api/repos/registry?path=…   take one off the list (its folder and profile stay)
//   POST   /api/repos/registry/check    read a profile and list what is wrong with it
// A status is always in words, never colour alone.
import { useEffect, useId, useState, type FormEvent } from 'react';
import { ApiError } from '../../api/client';
import type { ProfileCheck, RegisteredRepo, RepoRegistry } from '../../api/types';
import { HowThisWorks } from '../../components/HowThisWorks';
import { useWorkshop } from '../../state/store';
import { BRAND } from '../../app/brand';

type Load = { state: 'loading' } | { state: 'ready'; list: RepoRegistry } | { state: 'error'; message: string };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Each problem the dashboard gave, one per line: its list when it sent one, else its message. */
export function problemsOf(err: unknown): string[] {
  if (err instanceof ApiError && Array.isArray(err.body.errors) && err.body.errors.length) {
    return err.body.errors.filter((e): e is string => typeof e === 'string');
  }
  return [message(err)];
}

export const SOURCE_WORDS = {
  repo: 'its own ground-control.md',
  registry: `a profile file ${BRAND.name} keeps for it`,
} as const;

/** A row's state in a few words: what the list shows next to each repository. */
export function repoStatus(r: RegisteredRepo): string {
  if (!r.exists) return 'Folder not found';
  if (!r.ok) return r.errors.length === 1 ? 'Its profile has 1 problem' : `Its profile has ${r.errors.length} problems`;
  return 'Profile ready';
}

function Lines({ items, className, label }: { items: string[]; className: string; label: string }) {
  if (!items.length) return null;
  return (
    <ul className={className} aria-label={label}>
      {items.map((e, i) => <li key={i}>{e}</li>)}
    </ul>
  );
}

function CheckResult({ check }: { check: ProfileCheck }) {
  return (
    <div role="status">
      <p className={check.ok ? undefined : 'field-problem'}>
        {check.ok
          ? <>The profile reads well{check.name ? <>: <strong>{check.name}</strong></> : null}{check.ports ? <>, Try it ports {check.ports}</> : null}.</>
          : check.errors.length === 1 ? 'The profile has 1 problem:' : `The profile has ${check.errors.length} problems:`}
      </p>
      <Lines items={check.errors} className="field-problem" label="Problems in the profile" />
      {check.warnings.length > 0 && <p className="muted">Kept but not used:</p>}
      <Lines items={check.warnings} className="muted" label="Notes about the profile" />
    </div>
  );
}

function RepoRow({ repo, onChanged }: { repo: RegisteredRepo; onChanged: (list: RepoRegistry) => void }) {
  const { api } = useWorkshop();
  const [busy, setBusy] = useState<'check' | 'remove' | null>(null);
  const [check, setCheck] = useState<ProfileCheck | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const status = repoStatus(repo);

  async function recheck() {
    setBusy('check');
    setProblems([]);
    try {
      setCheck(await api.post<ProfileCheck>('/api/repos/registry/check', { path: repo.path }));
    } catch (err) {
      setProblems(problemsOf(err));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy('remove');
    setProblems([]);
    try {
      onChanged(await api.del<RepoRegistry>(`/api/repos/registry?path=${encodeURIComponent(repo.path)}`));
    } catch (err) {
      setProblems(problemsOf(err));
      setBusy(null);
    }
  }

  return (
    <li className="rule-row" data-repo={repo.path}>
      <div className="rule-row-main">
        <p className="rule-row-label">
          <strong>{repo.name}</strong>
          {repo.name !== repo.folder && <span className="muted"> ({repo.folder})</span>}
          {' · '}
          <span data-status={repo.exists ? (repo.ok ? 'ready' : 'problems') : 'missing'}>{status}</span>
        </p>
        <p className="rule-row-meta muted">
          <span title="The repository’s folder on this computer.">{repo.path}</span>
          {repo.github && <span className="chip" title="Its repository on GitHub.">GitHub {repo.github}</span>}
          {repo.ports && <span className="chip num" title="The ports Try it runs this repository’s app on.">Ports {repo.ports}</span>}
        </p>
        {repo.profileFile && (
          <p className="rule-row-meta muted">
            <span>Profile: {repo.profileSource ? SOURCE_WORDS[repo.profileSource] : 'a profile file'}</span>
            <span title={repo.profileFile}>· {repo.profileFile}</span>
          </p>
        )}
        {!repo.exists && <p className="perm-warn" role="note">This folder isn’t there any more. Remove it from the list, or put the repository back.</p>}
        {repo.exists && !repo.ok && <Lines items={repo.errors} className="field-problem" label={`Problems in ${repo.name}’s profile`} />}
        {repo.ok && repo.warnings.length > 0 && <Lines items={repo.warnings} className="muted" label={`Notes about ${repo.name}’s profile`} />}
        {check && <CheckResult check={check} />}
        {problems.length > 0 && <div role="alert"><Lines items={problems} className="field-problem" label="What went wrong" /></div>}
      </div>
      <div className="doc-actions">
        <button type="button" className="btn btn-quiet" disabled={busy !== null} onClick={() => void recheck()} aria-label={`Check ${repo.name}’s profile`} title="Read the profile again and list anything wrong with it.">
          {busy === 'check' ? 'Checking…' : 'Check'}
        </button>
        <button type="button" className="btn btn-quiet" disabled={busy !== null} onClick={() => void remove()} aria-label={`Remove ${repo.name} from the list`} title="Take this repository off the list. Its folder, its jobs and its profile file are left as they are.">
          {busy === 'remove' ? 'Removing…' : 'Remove'}
        </button>
      </div>
    </li>
  );
}

function AddRepo({ onAdded }: { onAdded: (list: RepoRegistry) => void }) {
  const { api } = useWorkshop();
  const id = useId();
  const [repoPath, setRepoPath] = useState('');
  const [profileFile, setProfileFile] = useState('');
  const [busy, setBusy] = useState<'check' | 'add' | null>(null);
  const [check, setCheck] = useState<ProfileCheck | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [added, setAdded] = useState<string | null>(null);
  const body = () => ({ path: repoPath.trim(), profileFile: profileFile.trim() || undefined });

  async function runCheck() {
    setBusy('check');
    setProblems([]);
    setAdded(null);
    setCheck(null);
    try {
      setCheck(await api.post<ProfileCheck>('/api/repos/registry/check', body()));
    } catch (err) {
      setProblems(problemsOf(err));
    } finally {
      setBusy(null);
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy('add');
    setProblems([]);
    setAdded(null);
    setCheck(null);
    try {
      const r = await api.post<RepoRegistry & { repo?: RegisteredRepo }>('/api/repos/registry', body());
      onAdded(r);
      setAdded(`Added ${r.repo?.name ?? repoPath.trim()}. New jobs in it follow its profile.`);
      setRepoPath('');
      setProfileFile('');
    } catch (err) {
      setProblems(problemsOf(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <form className="rule-options" onSubmit={(e) => void add(e)} data-setting="repos-add" aria-label="Add a repository">
      <h4 className="settings-heading">Add a repository</h4>
      <label htmlFor={`${id}-path`}>The repository’s folder</label>
      <input id={`${id}-path`} type="text" autoComplete="off" spellCheck={false} placeholder="/Users/you/Projects/your-repo" value={repoPath} onChange={(e) => setRepoPath(e.target.value)} />
      <label htmlFor={`${id}-profile`}>Profile file (only if the repository has no ground-control.md)</label>
      <input id={`${id}-profile`} type="text" autoComplete="off" spellCheck={false} placeholder="/Users/you/profiles/your-repo.md" value={profileFile} onChange={(e) => setProfileFile(e.target.value)} />
      <div className="doc-actions">
        <button type="button" className="btn btn-quiet" disabled={busy !== null || (!repoPath.trim() && !profileFile.trim())} onClick={() => void runCheck()} title="Read the profile and list anything wrong with it, without adding anything.">
          {busy === 'check' ? 'Checking…' : 'Check the profile'}
        </button>
        <button type="submit" className="btn" disabled={busy !== null || !repoPath.trim()} title="Add this repository, if its profile reads without problems.">
          {busy === 'add' ? 'Adding…' : 'Add'}
        </button>
      </div>
      {check && <CheckResult check={check} />}
      {problems.length > 0 && (
        <div role="alert">
          <p className="field-problem">{problems.length === 1 ? 'It wasn’t added:' : `It wasn’t added. ${problems.length} problems:`}</p>
          <Lines items={problems} className="field-problem" label="Why it wasn’t added" />
        </div>
      )}
      {added && <p role="status">{added}</p>}
    </form>
  );
}

export function ReposSettings() {
  const { api } = useWorkshop();
  const [load, setLoad] = useState<Load>({ state: 'loading' });

  useEffect(() => {
    let live = true;
    api.get<RepoRegistry>('/api/repos/registry').then(
      (list) => { if (live) setLoad({ state: 'ready', list }); },
      (err) => { if (live) setLoad({ state: 'error', message: message(err) }); },
    );
    return () => { live = false; };
  }, [api]);

  const show = (list: RepoRegistry) => setLoad({ state: 'ready', list: { repos: list.repos ?? [], file: list.file, unreadable: list.unreadable ?? null } });

  return (
    <section aria-label="Repositories">
      <h3 className="settings-heading">Repositories</h3>
      <HowThisWorks id="settings-repos">
        <p>Each repository here has a <strong>profile</strong>: how work is done in it. It names a ticket’s job and branch, where the worktree goes, and how <strong>Try it</strong> runs the app (its folder, the command, the ports and the settings file copied in from your main checkout).</p>
        <p>A repository’s own <code>ground-control.md</code>, in its top folder, is used first. Without one, name a profile file here. Orbit’s profile comes with {BRAND.name}. A job in a repository that isn’t here works as before, with the usual guesses.</p>
      </HowThisWorks>
      <div data-setting="repos-list">
        {load.state === 'loading' && <p className="muted">Loading the repositories…</p>}
        {load.state === 'error' && <p className="thread-error" role="alert">Couldn’t load the repositories: {load.message}</p>}
        {load.state === 'ready' && (
          <>
            {load.list.unreadable && (
              <p className="perm-warn" role="alert">The list file {load.list.unreadable} can’t be read, so no profile is used and nothing can be added. Fix or remove that file.</p>
            )}
            {load.list.repos.length === 0 ? (
              <p className="muted">No repositories yet. Add one below.</p>
            ) : (
              <ul className="rule-list" aria-label="Your repositories">
                {load.list.repos.map((r) => <RepoRow key={r.path} repo={r} onChanged={show} />)}
              </ul>
            )}
          </>
        )}
      </div>
      <AddRepo onAdded={show} />
    </section>
  );
}
