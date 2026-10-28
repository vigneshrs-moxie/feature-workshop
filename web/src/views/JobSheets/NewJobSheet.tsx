// Start a new job: what to build or fix, the repository (from GET /api/repos, or any folder path),
// the kind, the Foreman model, and optionally a past Claude Code conversation to start from (GET
// /api/history?q=...): a fresh Foreman reading a summary of it, or that conversation continued.
// POST /api/jobs; the job then opens. The level (L0–L3, decision D5) starts at the rules' instant
// suggestion from the description and follows it as you type, until you pick one yourself; it is
// sent as options.level, and the level's defaults set the stages and reviewers. Change it later
// from the level chip in the job header.
import { useEffect, useId, useMemo, useState } from 'react';
import type { HistoryList, HistoryRow, LevelNumber, ModelChoice, Repo } from '../../api/types';
import { navigate } from '../../app/router';
import { HowThisWorks } from '../../components/HowThisWorks';
import { Sheet } from '../../components/Sheet';
import { plainInline } from '../../lib/inlineMarkdown';
import { suggestFromDescription } from '../../lib/levels';
import { readStored, writeStored } from '../../lib/stored';
import { relativeTime, useNow } from '../../lib/time';
import { useWorkshop, useWorkshopState } from '../../state/store';
import { LevelPicker } from './LevelPicker';

export const LAST_REPO_KEY = 'fw.newJob.repo';
const OTHER = '__other';
const SEARCH_DELAY_MS = 250;
const SHOWN_ROWS = 8;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const tokens = (n: number | null | undefined) => (!n ? null : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

type Repos = { state: 'loading' } | { state: 'ready'; list: Repo[] } | { state: 'error'; message: string };
type Search = { state: 'idle' } | { state: 'loading' } | { state: 'ready'; list: HistoryList } | { state: 'error'; message: string };

function PastConversation({ picked, onPick, mode, onMode, canContinue }: {
  picked: HistoryRow | null; onPick: (row: HistoryRow | null, canContinue: boolean) => void;
  mode: 'summary' | 'continue'; onMode: (m: 'summary' | 'continue') => void; canContinue: boolean;
}) {
  const { api } = useWorkshop();
  const now = useNow();
  const [open, setOpen] = useState(picked !== null);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<Search>({ state: 'idle' });
  const searchId = useId();

  useEffect(() => {
    if (!open || picked) return;
    let cancelled = false;
    const t = setTimeout(() => {
      setSearch({ state: 'loading' });
      const q = new URLSearchParams({ q: query.trim() });
      api.get<HistoryList>(`/api/history?${q}`).then(
        (list) => { if (!cancelled) setSearch({ state: 'ready', list }); },
        (err) => { if (!cancelled) setSearch({ state: 'error', message: message(err) }); },
      );
    }, query ? SEARCH_DELAY_MS : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [api, open, picked, query]);

  if (picked) {
    const continueOff = !canContinue ? 'Not available here (the demo, or a custom history folder).' : !picked.repo ? 'Only for conversations that ran inside a repository.' : null;
    const size = tokens(picked.contextTokens);
    return (
      <fieldset className="from-session">
        <legend>Starting from a past conversation</legend>
        <p className="from-what">
          <strong>{plainInline(picked.title)}</strong>
          <span className="muted"> · {relativeTime(picked.lastAt, now) || 'unknown time'}{picked.messages ? ` · ${picked.messages} message${picked.messages === 1 ? '' : 's'}` : ''}{picked.branch ? ` · branch ${picked.branch}` : ''}</span>
          <button type="button" className="btn btn-quiet" onClick={() => onPick(null, canContinue)} title="Don’t start from this conversation after all.">Remove</button>
        </p>
        {!picked.repo && <p className="perm-warn">That conversation ran in {picked.cwd ?? 'an unknown folder'}, which isn’t a git repository. Pick the repository this job is for above.</p>}
        <div className="rule-options">
          <label className={`rule-option${mode === 'summary' ? ' is-picked' : ''}`} title="The Foreman reads a short extract of it, saved as history.md in the job’s private folder. Cheap, and a clean start.">
            <input type="radio" name="fromMode" checked={mode === 'summary'} onChange={() => onMode('summary')} />
            <span className="rule-option-body">
              <span className="rule-option-kind">Fresh Foreman with a summary<span className="chip">Recommended</span></span>
              <span className="muted">It reads what you asked, the files changed, the branch and how it ended.</span>
            </span>
          </label>
          <label
            className={`rule-option${mode === 'continue' ? ' is-picked' : ''}${continueOff ? ' is-off' : ''}`}
            title={continueOff ?? 'A copy of the conversation becomes the Foreman, so it remembers everything said. Your original stays as it was.'}
          >
            <input type="radio" name="fromMode" checked={mode === 'continue'} disabled={Boolean(continueOff)} onChange={() => onMode('continue')} />
            <span className="rule-option-body">
              <span className="rule-option-kind">Continue that conversation</span>
              <span className="muted">{continueOff ?? `It remembers everything said, and costs more: ${size ? `about ${size} tokens` : 'the whole conversation'} re-read on every reply.`}</span>
            </span>
          </label>
        </div>
      </fieldset>
    );
  }

  return (
    <details className="from-search" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary title="Optional: start from something you already discussed with Claude Code in a terminal.">Start from a past conversation (optional)</summary>
      <label className="field sheet-field" htmlFor={searchId}>
        <span>Search your past Claude Code conversations</span>
      </label>
      <input
        id={searchId}
        className="text-input"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Words from its title or first message"
        title="Searches the titles and first messages of your past conversations. Leave it empty to see the latest."
      />
      {search.state === 'loading' && <p className="muted" role="status">Searching…</p>}
      {search.state === 'error' && <p className="field-problem" role="alert">{search.message}</p>}
      {search.state === 'ready' && (
        search.list.rows.length === 0 ? (
          <p className="muted" role="status">{query ? `No conversation matches “${query}”.` : 'No past conversations found.'}</p>
        ) : (
          <ul className="history-results" aria-label="Past conversations">
            {search.list.rows.slice(0, SHOWN_ROWS).map((r) => (
              <li key={r.id} className="history-row">
                <span className="history-row-main">
                  <span className="history-title">{plainInline(r.title)}</span>
                  <span className="muted history-meta">{[relativeTime(r.lastAt, now), r.repo ? r.repo.split('/').pop() : 'no repository', r.messages ? `${r.messages} messages` : ''].filter(Boolean).join(' · ')}</span>
                </span>
                <button type="button" className="btn" onClick={() => onPick(r, search.list.canContinue)} aria-label={`Use “${plainInline(r.title)}”`} title="Start this job from that conversation. You choose how on the next step.">Use this</button>
              </li>
            ))}
          </ul>
        )
      )}
      {search.state === 'ready' && search.list.matched > SHOWN_ROWS && <p className="muted sheet-fine">Showing {SHOWN_ROWS} of {search.list.matched}. Add words to narrow it.</p>}
    </details>
  );
}

export function NewJobSheet({ onClose, description: initialDescription = '' }: { onClose: () => void; description?: string }) {
  const { api } = useWorkshop();
  const { meta } = useWorkshopState();
  const models: ModelChoice[] = meta?.models ?? [];
  const [description, setDescription] = useState(initialDescription);
  const [kind, setKind] = useState<'feature' | 'bug'>('feature');
  const [repos, setRepos] = useState<Repos>({ state: 'loading' });
  const [repo, setRepo] = useState<string>('');
  const [otherPath, setOtherPath] = useState('');
  const [model, setModel] = useState<string>(models[0]?.id ?? '');
  const [from, setFrom] = useState<HistoryRow | null>(null);
  const [fromMode, setFromMode] = useState<'summary' | 'continue'>('summary');
  const [canContinue, setCanContinue] = useState(false);
  // Your own pick; until there is one, the level follows the rules' suggestion as you type.
  const [picked, setPicked] = useState<LevelNumber | null>(null);
  const suggestion = useMemo(() => suggestFromDescription(description), [description]);
  const level: LevelNumber | null = picked ?? suggestion?.level ?? null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const descId = useId();
  const repoId = useId();
  const pathId = useId();

  useEffect(() => {
    let cancelled = false;
    api.get<{ repos: Repo[] }>('/api/repos').then(
      (r) => {
        if (cancelled) return;
        const list = Array.isArray(r?.repos) ? r.repos : [];
        setRepos({ state: 'ready', list });
        const last = readStored(LAST_REPO_KEY);
        setRepo((cur) => cur || (last && list.some((x) => x.path === last) ? last : list[0]?.path ?? OTHER));
      },
      (err) => { if (!cancelled) { setRepos({ state: 'error', message: message(err) }); setRepo((cur) => cur || OTHER); } },
    );
    return () => { cancelled = true; };
  }, [api]);

  useEffect(() => { if (!model && models[0]) setModel(models[0].id); }, [model, models]);

  const list = repos.state === 'ready' ? repos.list : [];
  const options = from?.repo && !list.some((r) => r.path === from.repo) ? [{ path: from.repo, name: from.repo.split('/').pop() ?? from.repo }, ...list] : list;

  function pick(row: HistoryRow | null, cont: boolean) {
    setFrom(row);
    setFromMode('summary');
    setCanContinue(cont);
    if (!row) return;
    if (!description.trim()) setDescription(row.title.slice(0, 600));
    setRepo(row.repo ?? OTHER);
  }

  async function submit() {
    const text = description.trim();
    const repoPath = repo === OTHER ? otherPath.trim() : repo;
    if (text.length < 4) { setError('Describe the job in a few words.'); return; }
    if (!repoPath) { setError('Pick the repository, or type the full path of its folder.'); return; }
    setBusy(true);
    setError(null);
    try {
      const fromSession = from ? { id: from.id, mode: fromMode } : undefined;
      const options = level !== null ? { level } : {};
      const r = await api.post<{ slug: string }>('/api/jobs', { description: text, kind, repoPath, model: model || undefined, options, fromSession });
      writeStored(LAST_REPO_KEY, repoPath);
      onClose();
      if (r?.slug) navigate({ name: 'job', slug: r.slug });
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  }

  return (
    <Sheet title="Start a new job" onClose={onClose} busy={busy} className="new-job-sheet">
      <HowThisWorks id="new-job">
        <p>Describe the job in a line and pick where it runs. A Foreman (a Claude Code session) starts on it straight away: it writes up what it will do and asks you before any code changes. Pushes and pull requests always ask you too.</p>
        <p><strong>Levels</strong> set how much process the job gets. <strong>L0 Tweak</strong>: one build, the checks, and you look at the diff. <strong>L1 Small</strong>: a quick plan you approve, one reviewer. <strong>L2 Standard</strong>: a short spec and plan, the tester, 3–4 reviewers. <strong>L3 Large</strong>: the full workflow, every reviewer and Fable second looks. Each level shows what runs next to it.</p>
        <p>As you type, the rules suggest a level from your description (no AI involved): risky areas such as sign-in, data scoping or migrations need at least L2 or L3. Pick another level any time; after that the suggestion no longer changes your pick. If you pick below what the rules suggest, the Foreman asks before building. The Foreman also suggests a level in its first brief; if it differs, a card in the conversation lets you choose. Change it later with the level chip in the job header.</p>
        <p>The level sets the job’s <strong>options</strong> (stages, reviewers); fine-tune them later with <strong>Notes and options…</strong> in the job menu. To pick up something you already discussed with Claude Code, open <strong>Start from a past conversation</strong>.</p>
      </HowThisWorks>
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <fieldset className="sheet-fields" disabled={busy}>
          <label className="field sheet-field" htmlFor={descId}><span>What should the crew build or fix?</span></label>
          <textarea
            id={descId}
            data-autofocus
            className="text-area"
            rows={2}
            maxLength={600}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit(); } }}
            placeholder="e.g. Add a Copy ID button next to the ticket ID on the admin ticket page"
            title="One or two sentences. It also becomes the job’s name. ⌘/Ctrl+Enter starts the job."
          />

          <div className="seg" role="radiogroup" aria-label="Kind">
            <span className="seg-label muted">Kind</span>
            <label className={kind === 'feature' ? 'seg-option is-picked' : 'seg-option'} title="Something new, or a change to how something works.">
              <input type="radio" name="kind" value="feature" checked={kind === 'feature'} onChange={() => setKind('feature')} /> Feature
            </label>
            <label className={kind === 'bug' ? 'seg-option is-picked' : 'seg-option'} title="Something that’s broken. The Foreman starts by finding the cause.">
              <input type="radio" name="kind" value="bug" checked={kind === 'bug'} onChange={() => setKind('bug')} /> Bug fix
            </label>
          </div>

          <LevelPicker levels={meta?.levels} value={level} suggestion={suggestion} byHand={picked !== null} onPick={setPicked} disabled={busy} />

          <label className="field sheet-field" htmlFor={repoId}><span>Repository</span></label>
          <select
            id={repoId}
            className="select"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            disabled={repos.state === 'loading'}
            title="The git repository the job works in. The ones you used most recently with Claude Code are listed first."
          >
            {repos.state === 'loading' && <option value="">Loading your repositories…</option>}
            {options.map((r) => <option key={r.path} value={r.path}>{r.name} — {r.path}</option>)}
            <option value={OTHER}>Another folder…</option>
          </select>
          {repos.state === 'error' && <p className="muted sheet-fine">Couldn’t list your repositories ({repos.message}). Type the folder’s path instead.</p>}
          {repo === OTHER && (
            <>
              <label className="field sheet-field" htmlFor={pathId}><span>Folder path</span></label>
              <input
                id={pathId}
                className="text-input num"
                type="text"
                value={otherPath}
                onChange={(e) => setOtherPath(e.target.value)}
                placeholder="/Users/you/Projects/your-repo"
                spellCheck={false}
                title="The full path of a folder inside a git repository, starting with /."
              />
            </>
          )}

          <div className="rule-options" role="radiogroup" aria-label="Foreman model">
            <span className="seg-label muted">Foreman model</span>
            {models.map((m) => (
              <label key={m.id} className={`rule-option${model === m.id ? ' is-picked' : ''}`} title={`Run this job’s Foreman on ${m.label}. You can change it for any later message.`}>
                <input type="radio" name="model" value={m.id} checked={model === m.id} onChange={() => setModel(m.id)} />
                <span className="rule-option-body">
                  <span className="rule-option-kind">{m.label}</span>
                  {m.note && <span className="muted">{m.note}</span>}
                </span>
              </label>
            ))}
          </div>

          <PastConversation picked={from} onPick={pick} mode={fromMode} onMode={setFromMode} canContinue={canContinue} />
        </fieldset>

        <p className="muted sheet-fine">Runs with your own Claude Code login. Workers use the models set in their agent files.{meta?.demo ? ' Demo mode: a pretend Foreman answers; nothing real runs.' : ''}</p>
        {error && <p className="field-problem" role="alert">{error}</p>}
        <div className="sheet-actions">
          <button type="submit" className="btn btn-primary" disabled={busy} title="Start the job now. Its Foreman reads your request and replies in the conversation.">
            {busy ? 'Starting…' : 'Start job'}
          </button>
          <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy} title="Close without starting anything.">Cancel</button>
        </div>
      </form>
    </Sheet>
  );
}
