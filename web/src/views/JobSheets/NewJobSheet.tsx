// Start a new job: what to build or fix, the repository (from GET /api/repos, or any folder path),
// the kind, the Foreman model, and optionally a past Claude Code conversation to start from (GET
// /api/history?q=...): a fresh Foreman reading a summary of it, or that conversation continued.
// POST /api/jobs; the job then opens. The level (L0–L3, decision D5) starts at the rules' instant
// suggestion from the description and follows it as you type, until you pick one yourself; it is
// sent as options.level, and the level's defaults set the stages and reviewers. Change it later
// from the level chip in the job header.
//
// The Orbit ticket (plan D1): a job started from a ticket shares its key; the dashboard names the
// job's folder orbit-<n>-<short-title> and its branch feature/ (or fix/) plus that, and the Foreman
// reads the ticket through the orbit-feedback MCP server. Started from the Inbox (a `ticket`, or a
// description the Inbox filled in as "ORBIT-<n>: <title>"), the field is filled in and read-only;
// otherwise you may type a key yourself, or leave it empty.
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
import { OptionRow, Segmented } from '../../components/Choice';
import { Select } from '../../components/Select';
import { Button } from '../../components/Button';
import { TextArea, TextInput } from '../../components/Field';
import { Chip } from '../../components/Chip';
import './jobSheets.css';

export const LAST_REPO_KEY = 'fw.newJob.repo';
const OTHER = '__other';
const SEARCH_DELAY_MS = 250;
const SHOWN_ROWS = 8;

/** A ticket a job starts from: the key (ORBIT-<n>), and its title and link when the Inbox knows them. */
export interface TicketRef { key: string; title?: string | null; url?: string | null }

export const TICKET_KEY_PROBLEM = 'That isn’t a ticket key: use ORBIT- and the number, like ORBIT-479.';
/** ORBIT-<n> for ORBIT-479, orbit-479, orbit479, #479 or 479; else null (the dashboard's own rule). */
export function ticketKeyOf(raw: string): string | null {
  const m = /^(?:orbit-?)?#?([1-9]\d{0,8})$/i.exec(raw.trim());
  return m ? `ORBIT-${Number(m[1])}` : null;
}
/** The ticket in a description the Inbox's Start filled in ("ORBIT-479: Feedback API"), else null. */
export function ticketFromDescription(text: string): TicketRef | null {
  const m = /^(ORBIT-[1-9]\d{0,8}):\s*(.*)$/s.exec(text.trim());
  return m ? { key: m[1], title: m[2].trim() || null, url: null } : null;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const tilde = (p: string) => p.replace(/^\/Users\/[^/]+/, '~');
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
        <legend className="field-label">Starting from a past conversation</legend>
        <div className="from-what">
          <span className="from-what-words">
            <strong>{plainInline(picked.title)}</strong>
            <span className="muted"> · {relativeTime(picked.lastAt, now) || 'unknown time'}{picked.messages ? ` · ${picked.messages} message${picked.messages === 1 ? '' : 's'}` : ''}{picked.branch ? ` · branch ${picked.branch}` : ''}</span>
          </span>
          <Button kind="quiet" size="sm" onClick={() => onPick(null, canContinue)} title="Don’t start from this conversation after all.">Remove</Button>
        </div>
        {!picked.repo && <p className="perm-warn">That conversation ran in {picked.cwd ?? 'an unknown folder'}, which isn’t a git repository. Pick the repository this job is for above.</p>}
        <div className="sheet-options">
          <OptionRow type="radio" name="fromMode" checked={mode === 'summary'} onChange={() => onMode('summary')} title="The Foreman reads a short extract of it, saved as history.md in the job’s private folder. Cheap, and a clean start.">
            <span className="option-body">
              <span className="option-title">Fresh Foreman with a summary<Chip tone="accent">Recommended</Chip></span>
              <span className="option-desc">It reads what you asked, the files changed, the branch and how it ended.</span>
            </span>
          </OptionRow>
          <OptionRow
            type="radio"
            name="fromMode"
            checked={mode === 'continue'}
            disabled={Boolean(continueOff)}
            onChange={() => onMode('continue')}
            title={continueOff ?? 'A copy of the conversation becomes the Foreman, so it remembers everything said. Your original stays as it was.'}
          >
            <span className="option-body">
              <span className="option-title">Continue that conversation</span>
              <span className="option-desc">{continueOff ?? `It remembers everything said, and costs more: ${size ? `about ${size} tokens` : 'the whole conversation'} re-read on every reply.`}</span>
            </span>
          </OptionRow>
        </div>
      </fieldset>
    );
  }

  return (
    <details className="from-search" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary title="Optional: start from something you already discussed with Claude Code in a terminal.">Start from a past conversation (optional)</summary>
      <div className="field from-search-body">
        <label className="field-label" htmlFor={searchId}>Search your past Claude Code conversations</label>
        <TextInput
          id={searchId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Words from its title or first message"
          title="Searches the titles and first messages of your past conversations. Leave it empty to see the latest."
        />
      </div>
      {search.state === 'loading' && <p className="muted from-status" role="status">Searching…</p>}
      {search.state === 'error' && <p className="field-problem" role="alert">{search.message}</p>}
      {search.state === 'ready' && (
        search.list.rows.length === 0 ? (
          <p className="muted from-status" role="status">{query ? `No conversation matches “${query}”.` : 'No past conversations found.'}</p>
        ) : (
          <ul className="history-results" aria-label="Past conversations">
            {search.list.rows.slice(0, SHOWN_ROWS).map((r) => (
              <li key={r.id} className="history-row">
                <span className="history-row-main">
                  <span className="history-title">{plainInline(r.title)}</span>
                  <span className="muted history-meta">{[relativeTime(r.lastAt, now), r.repo ? r.repo.split('/').pop() : 'no repository', r.messages ? `${r.messages} messages` : ''].filter(Boolean).join(' · ')}</span>
                </span>
                <Button size="sm" onClick={() => onPick(r, search.list.canContinue)} aria-label={`Use “${plainInline(r.title)}”`} title="Start this job from that conversation. You choose how on the next step.">Use this</Button>
              </li>
            ))}
          </ul>
        )
      )}
      {search.state === 'ready' && search.list.matched > SHOWN_ROWS && <p className="sheet-fine">Showing {SHOWN_ROWS} of {search.list.matched}. Add words to narrow it.</p>}
    </details>
  );
}

export function NewJobSheet({ onClose, description: initialDescription = '', ticket: givenTicket, stack: startAsStack = false }: { onClose: () => void; description?: string; ticket?: TicketRef | null; stack?: boolean }) {
  const { api } = useWorkshop();
  const { meta } = useWorkshopState();
  const models: ModelChoice[] = meta?.models ?? [];
  const [description, setDescription] = useState(initialDescription || (givenTicket ? `${givenTicket.key}: ${givenTicket.title ?? ''}`.trim() : ''));
  // From the Inbox: fixed. Typed here: optional, checked when you start.
  const [fromInbox] = useState<TicketRef | null>(() => givenTicket ?? ticketFromDescription(initialDescription));
  const [ticketText, setTicketText] = useState(fromInbox?.key ?? '');
  const ticketId = useId();
  const [kind, setKind] = useState<'feature' | 'bug'>('feature');
  // Run as a stack (views/Stack): ticked by the Inbox's Start as stack.
  const [asStack, setAsStack] = useState(startAsStack);
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
    const key = ticketText.trim() ? ticketKeyOf(ticketText) : null;
    if (ticketText.trim() && !key) { setError(TICKET_KEY_PROBLEM); return; }
    const ticket = key
      // The Inbox's title and link; for a key you typed, the description (the dashboard drops a leading "ORBIT-<n>:").
      ? { key, title: fromInbox?.key === key ? fromInbox.title ?? null : text, url: fromInbox?.key === key ? fromInbox.url ?? null : null }
      : undefined;
    setBusy(true);
    setError(null);
    try {
      const fromSession = from ? { id: from.id, mode: fromMode } : undefined;
      const options = { ...(level !== null ? { level } : {}), ...(asStack ? { stack: true } : {}) };
      const r = await api.post<{ slug: string }>('/api/jobs', { description: text, kind, repoPath, model: model || undefined, options, fromSession, ticket });
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
          <div className="field">
            <label className="field-label" htmlFor={descId}>What should the crew build or fix?</label>
            <TextArea
              id={descId}
              data-autofocus
              rows={3}
              maxLength={600}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit(); } }}
              placeholder="e.g. Add a Copy ID button next to the ticket ID on the admin ticket page"
              title="One or two sentences. It also becomes the job’s name. ⌘/Ctrl+Enter starts the job."
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor={repoId}>Repository</label>
            <Select
              id={repoId}
              className="sheet-select"
              value={repo}
              onChange={setRepo}
              disabled={repos.state === 'loading'}
              title="The git repository the job works in. The ones you used most recently with Claude Code are listed first."
              options={[
                ...(repos.state === 'loading' ? [{ value: '', label: 'Loading your repositories…' }] : []),
                ...options.map((r) => ({ value: r.path, label: <><span className="repo-name">{r.name}</span><span className="repo-path">{tilde(r.path)}</span></>, text: r.name })),
                { value: OTHER, label: 'Another folder…' },
              ]}
            />
            {repos.state === 'error' && <p className="field-hint">Couldn’t list your repositories ({repos.message}). Type the folder’s path instead.</p>}
          </div>
          {repo === OTHER && (
            <div className="field">
              <label className="field-label" htmlFor={pathId}>Folder path</label>
              <TextInput
                id={pathId}
                className="num"
                value={otherPath}
                onChange={(e) => setOtherPath(e.target.value)}
                placeholder="/Users/you/Projects/your-repo"
                spellCheck={false}
                title="The full path of a folder inside a git repository, starting with /."
              />
            </div>
          )}

          <div className="sheet-row">
            <div className="field">
              <label className="field-label" htmlFor={ticketId}>{fromInbox ? 'Orbit ticket' : 'Orbit ticket (optional)'}</label>
              <TextInput
                id={ticketId}
                className="num"
                value={ticketText}
                readOnly={Boolean(fromInbox)}
                aria-readonly={fromInbox ? true : undefined}
                onChange={(e) => setTicketText(e.target.value)}
                placeholder="ORBIT-479"
                spellCheck={false}
                title={fromInbox ? 'Started from this ticket in the Inbox. The job, its branch and the ticket share this key.' : 'The Orbit ticket this job is for, like ORBIT-479. The job’s folder and branch are then named after it. Leave it empty for a job without a ticket.'}
              />
            </div>
            <div className="field">
              <span className="field-label" aria-hidden="true">Kind</span>
              <Segmented
                label="Kind"
                className="kind-segments"
                value={kind}
                onChange={(v) => setKind(v === 'bug' ? 'bug' : 'feature')}
                disabled={busy}
                options={[
                  { value: 'feature', label: 'Feature', title: 'Something new, or a change to how something works.' },
                  { value: 'bug', label: 'Bug fix', title: 'Something that’s broken. The Foreman starts by finding the cause.' },
                ]}
              />
            </div>
          </div>
          {fromInbox
            ? <p className="field-hint">From the Inbox. The job, its branch and the ticket share this key, and the Foreman reads the ticket through Orbit (read only).</p>
            : ticketText.trim() && !ticketKeyOf(ticketText) ? <p className="field-problem">{TICKET_KEY_PROBLEM}</p> : null}

          <LevelPicker levels={meta?.levels} value={level} suggestion={suggestion} byHand={picked !== null} onPick={setPicked} disabled={busy} />

          {models.length > 0 && (
            <div className="field">
              <span className="field-label" aria-hidden="true">Foreman model</span>
              <Segmented
                label="Foreman model"
                className="model-segments"
                value={model}
                onChange={setModel}
                disabled={busy}
                options={models.map((m) => ({
                  value: m.id,
                  title: `Run this job’s Foreman on ${m.label}. You can change it for any later message.`,
                  label: <>{m.label}{m.note && <span className="sr-only">: {m.note}</span>}</>,
                }))}
              />
              <p className="field-hint">{models.find((m) => m.id === model)?.note ?? '\u00a0'}</p>
            </div>
          )}

          <OptionRow type="checkbox" className="sheet-option" checked={asStack} onChange={(e) => setAsStack(e.target.checked)} disabled={busy} title="For a big ticket: the work is split into parts that are built side by side, then joined in order.">
            <span className="option-body" data-setting="run-as-stack">
              <span className="option-title">Run as a stack</span>
              <span className="option-desc">For a big ticket: the Foreman splits the work into parts that are built side by side, then joined in order. You check the parts on the Stack page before anything is built.</span>
            </span>
          </OptionRow>

          <PastConversation picked={from} onPick={pick} mode={fromMode} onMode={setFromMode} canContinue={canContinue} />
        </fieldset>

        <p className="sheet-fine">Runs with your own Claude Code login. Workers use the models set in their agent files.{meta?.demo ? ' Demo mode: a pretend Foreman answers; nothing real runs.' : ''}</p>
        {error && <p className="field-problem" role="alert">{error}</p>}
        <div className="sheet-actions">
          <Button onClick={onClose} disabled={busy} title="Close without starting anything.">Cancel</Button>
          <Button type="submit" kind="primary" disabled={busy} title="Start the job now. Its Foreman reads your request and replies in the conversation.">
            {busy ? 'Starting…' : 'Start job'}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
