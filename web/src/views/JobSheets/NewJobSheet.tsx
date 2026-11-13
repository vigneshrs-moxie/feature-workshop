// Start a new job: what to build or fix, the repository (from GET /api/repos, or any folder path),
// the kind, the Foreman model, and optionally a past Claude Code conversation to start from (GET
// /api/history?q=...): a fresh Foreman reading a summary of it, or that conversation continued.
// POST /api/jobs; the job then opens. The level (L0–L3, decision D5) starts at the rules' instant
// suggestion from the description and follows it as you type, until you pick one yourself; it is
// sent as options.level, and the level's defaults set the stages and reviewers. Change it later
// from the level chip in the job header.
//
// The Orbit ticket (plan D1): a job started from a ticket shares its key; the dashboard names the
// job's folder orbit-<n>-<short-title> and its branch feature/ (or fix/) plus that, and Starbase
// writes the ticket's details to ticket.md in the job's folder for the Foreman. Started from the Inbox (a `ticket`, or a
// description the Inbox filled in as "ORBIT-<n>: <title>"), the field is filled in and read-only;
// otherwise you may type a key yourself, or leave it empty.
//
// The branch (Auto queue, Task 20): with a ticket and a repository, the form asks the laptop for a
// short name (POST /api/jobs/name) and shows it after the branch's prefix (feature/orbit-471-), with
// Suggest again. Typing makes the name his: an answer that comes by itself never replaces it. Start
// sends `name` only for the model's name or his own that keeps the rule; otherwise the laptop names
// the job when it starts. Start never waits for the answer.
//
// On the hosted website (the `hosted` prop) the same form starts a job on one of your laptops: the
// repositories are the chosen laptop's (names only), there is no past conversation, the branch is
// named when the job starts (the site can't ask for a name), and Start job hands the choices to
// `hosted.onStart` instead of POSTing /api/jobs.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { HistoryList, HistoryRow, JobNameAnswer, LevelNumber, ModelChoice, Repo } from '../../api/types';
import { BRAND } from '../../app/brand';
import { navigate } from '../../app/router';
import { HowThisWorks } from '../../components/HowThisWorks';
import { Sheet } from '../../components/Sheet';
import { plainInline } from '../../lib/inlineMarkdown';
import { ALL_FABLE_HINT, FABLE } from '../../lib/jobOptions';
import { AutoSwitch } from '../../job/AutoSwitch';
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

/** What the website's Start sends: the form's choices; the laptop checks them again. */
export interface StartChoices {
  description: string; kind: 'feature' | 'bug'; laptopId: number; repo?: string; model?: string;
  options: { level?: LevelNumber; stack?: true; all_fable?: true; auto?: true };
}
/** The website's side of the form: each laptop with the repository names it offered, and what to do with the choices. */
export interface HostedStart {
  laptops: { id: number; name: string; online: boolean; repos: { name: string; default: boolean }[] }[];
  onStart: (choices: StartChoices) => Promise<void>;
}
/** The Foreman models, for the form where the laptop's own list isn't to hand (the website). */
const SITE_MODELS: ModelChoice[] = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', note: 'The everyday Foreman: strong and much cheaper than Fable.' },
  { id: 'claude-fable-5-2', label: 'Fable 5.2', note: 'Best judgment, highest cost and quickest to use up your limits.' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5', note: `Cheapest. For trying ${BRAND.name} out, not real jobs.` },
];

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

/** The ticket that goes with the job: the Inbox's title and link; for a key you typed, the description (the dashboard drops a leading "ORBIT-<n>:"). */
function ticketOf(key: string, fromInbox: TicketRef | null, text: string): { key: string; title: string | null; url: string | null } {
  return { key, title: fromInbox?.key === key ? fromInbox.title ?? null : text, url: fromInbox?.key === key ? fromInbox.url ?? null : null };
}

export const BRANCH_RULE = 'Use short words joined by hyphens, like employee-status-filter (up to five words, 40 characters).';
const BRANCH_LATER = 'named when the job starts';
const NAME_DELAY_MS = 300;
const AVOID_MAX = 5;
/** A branch name of his own as the laptop's ownName reads it (trimmed, lowercased; one to five words of letters and digits joined by hyphens; at most 40 characters), else null. */
export function ownBranchName(raw: string): string | null {
  const name = raw.trim().toLowerCase();
  return name.length <= 40 && /^[a-z0-9]+(-[a-z0-9]+){0,4}$/.test(name) ? name : null;
}
const isNameAnswer = (a: unknown): a is JobNameAnswer => {
  const x = a as Partial<JobNameAnswer> | null;
  return !!x && typeof x.name === 'string' && (x.by === 'model' || x.by === 'title') && typeof x.branch === 'string';
};

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

export function NewJobSheet({ onClose, description: initialDescription = '', ticket: givenTicket, stack: startAsStack = false, kind: initialKind = 'feature', hosted }: {
  onClose: () => void; description?: string; ticket?: TicketRef | null; stack?: boolean; kind?: 'feature' | 'bug'; hosted?: HostedStart;
}) {
  const { api } = useWorkshop();
  const { meta } = useWorkshopState();
  const models: ModelChoice[] = hosted ? SITE_MODELS : meta?.models ?? [];
  const [description, setDescription] = useState(initialDescription || (givenTicket ? `${givenTicket.key}: ${givenTicket.title ?? ''}`.trim() : ''));
  // From the Inbox: fixed. Typed here: optional, checked when you start.
  const [fromInbox] = useState<TicketRef | null>(() => givenTicket ?? ticketFromDescription(initialDescription));
  const [ticketText, setTicketText] = useState(fromInbox?.key ?? '');
  const ticketId = useId();
  const [kind, setKind] = useState<'feature' | 'bug'>(initialKind);
  // Run as a stack (views/Stack): ticked by the Inbox's Start as stack.
  const [asStack, setAsStack] = useState(startAsStack);
  // The whole job on Fable: the Foreman too, so its model picker is fixed on Fable while this is on.
  const [allFable, setAllFable] = useState(false);
  const [auto, setAuto] = useState(false);
  const [repos, setRepos] = useState<Repos>(hosted ? { state: 'ready', list: [] } : { state: 'loading' });
  const [repo, setRepo] = useState<string>('');
  // The website: which laptop. One laptop, or one that is on, is picked for you.
  const [laptopId, setLaptopId] = useState<number | null>(() => {
    if (!hosted) return null;
    const on = hosted.laptops.filter((l) => l.online);
    return hosted.laptops.length === 1 ? hosted.laptops[0].id : on.length === 1 ? on[0].id : null;
  });
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

  // The website: the repositories are the chosen laptop's, by name; its default first.
  useEffect(() => {
    if (!hosted) return;
    const mine = hosted.laptops.find((l) => l.id === laptopId)?.repos ?? [];
    setRepos({ state: 'ready', list: mine.map((r) => ({ path: r.name, name: r.name })) });
    setRepo((mine.find((r) => r.default) ?? mine[0])?.name ?? '');
  }, [hosted, laptopId]);

  useEffect(() => {
    if (hosted) return;
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
  }, [api, hosted]);

  useEffect(() => { if (!model && models[0]) setModel(models[0].id); }, [model, models]);

  const list = repos.state === 'ready' ? repos.list : [];
  const options = from?.repo && !list.some((r) => r.path === from.repo) ? [{ path: from.repo, name: from.repo.split('/').pop() ?? from.repo }, ...list] : list;

  // The branch (Task 20): asked for once per ticket (with its title), kind and repository, a moment
  // after they settle. For an Inbox ticket, editing the description doesn't ask again; Suggest again does.
  const ticketKey = ticketText.trim() ? ticketKeyOf(ticketText) : null;
  const chosenRepo = repo === OTHER ? otherPath.trim() : repo;
  const nameBody = ticketKey && chosenRepo && !hosted
    ? { ticket: ticketOf(ticketKey, fromInbox, description.trim()), description: description.trim(), kind, repoPath: chosenRepo }
    : null;
  const askKey = nameBody ? JSON.stringify([nameBody.ticket, kind, chosenRepo]) : null;
  // The prefix (feature/orbit-471-) holds for a kind and a ticket, whatever the name.
  const prefixKey = `${kind} ${ticketKey ?? ''}`;
  // His own once he types; until then the model's name, or empty (the laptop names it at the start).
  const [branchName, setBranchName] = useState<{ value: string; by: 'model' | 'own' }>({ value: '', by: 'model' });
  const [nameAnswer, setNameAnswer] = useState<{ ask: string; answer: JobNameAnswer } | null>(null);
  const [goodPrefix, setGoodPrefix] = useState<{ key: string; prefix: string } | null>(null);
  const [shownNames, setShownNames] = useState<string[]>([]);
  const [asking, setAsking] = useState(false);
  const askSeq = useRef(0);
  // The ask Suggest again started: its answer replaces even his own name, unless he types meanwhile.
  const askedByHand = useRef(0);
  const currentAsk = useRef<string | null>(null);
  currentAsk.current = askKey;
  const branchId = useId();
  const prefixId = useId();
  const ruleId = useId();

  function askName(body: NonNullable<typeof nameBody>, ask: string, forPrefix: string, avoid?: string[]): number {
    const seq = ++askSeq.current;
    setAsking(true);
    api.post<unknown>('/api/jobs/name', avoid?.length ? { ...body, avoid } : body).then(
      (a) => {
        if (seq !== askSeq.current) return;
        setAsking(false);
        if (isNameAnswer(a)) takeName(a, ask, forPrefix, seq);
      },
      // A failed or slow ask shows nothing: the form stays as it was.
      () => { if (seq === askSeq.current) setAsking(false); },
    );
    return seq;
  }

  function takeName(a: JobNameAnswer, ask: string, forPrefix: string, seq: number) {
    if (ask !== currentAsk.current) return;
    setNameAnswer({ ask, answer: a });
    // A title answer is only the placeholder; its name never goes in the field or back to the laptop.
    if (a.by !== 'model' || !a.name) return;
    if (a.branch.endsWith(a.name)) setGoodPrefix({ key: forPrefix, prefix: a.branch.slice(0, -a.name.length) });
    setShownNames((s) => [...s.filter((x) => x !== a.name), a.name]);
    const byHand = askedByHand.current === seq;
    setBranchName((cur) => (cur.by === 'own' && !byHand ? cur : { value: a.name, by: 'model' }));
  }

  useEffect(() => {
    if (!askKey || !nameBody) return;
    const t = setTimeout(() => askName(nameBody, askKey, prefixKey), NAME_DELAY_MS);
    return () => clearTimeout(t);
    // One ask per askKey: nameBody and prefixKey follow from it.
  }, [askKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Another ticket: the last one's suggestions don't fit it.
  useEffect(() => {
    setBranchName((cur) => (cur.by === 'model' && cur.value ? { value: '', by: 'model' } : cur));
    setShownNames((s) => (s.length ? [] : s));
  }, [ticketKey]);

  function suggestAgain() {
    if (!nameBody || !askKey) return;
    askedByHand.current = askName(nameBody, askKey, prefixKey, shownNames.slice(-AVOID_MAX));
  }

  const answer = nameAnswer && nameAnswer.ask === askKey ? nameAnswer.answer : null;
  const branchPlaceholder = answer?.by === 'title' && answer.name ? answer.name : BRANCH_LATER;
  // The name shown is the model's, but the branch doesn't end with it (a "-2"): the whole branch, as plain text.
  const wholeBranch = answer?.by === 'model' && branchName.by === 'model' && branchName.value === answer.name && !answer.branch.endsWith(answer.name) ? answer.branch : null;
  const branchPrefix = !wholeBranch && goodPrefix?.key === prefixKey ? goodPrefix.prefix : null;
  const ownName = branchName.by === 'own' ? ownBranchName(branchName.value) : null;
  const branchProblem = branchName.by === 'own' && branchName.value.trim() !== '' && !ownName;
  // What Start sends as `name`: the model's name, or his own that keeps the rule; else nothing.
  const sentName = branchName.by === 'model' ? branchName.value || null : ownName;

  function pick(row: HistoryRow | null, cont: boolean) {
    setFrom(row);
    setFromMode('summary');
    setCanContinue(cont);
    if (!row) return;
    if (!description.trim()) setDescription(row.title.slice(0, 600));
    setRepo(row.repo ?? OTHER);
  }

  async function submit() {
    if (busy) return;
    const text = description.trim();
    const repoPath = repo === OTHER ? otherPath.trim() : repo;
    if (text.length < 4) { setError('Describe the job in a few words.'); return; }
    if (hosted) {
      if (laptopId === null) { setError('Pick which laptop starts it.'); return; }
      setBusy(true);
      setError(null);
      try {
        await hosted.onStart({
          description: text, kind, laptopId, ...(repoPath ? { repo: repoPath } : {}), ...((allFable ? FABLE : model) ? { model: allFable ? FABLE : model } : {}),
          options: { ...(level !== null ? { level } : {}), ...(asStack ? { stack: true as const } : {}), ...(allFable ? { all_fable: true as const } : {}), ...(auto ? { auto: true as const } : {}) },
        });
        onClose();
      } catch (err) { setError(message(err)); setBusy(false); }
      return;
    }
    if (!repoPath) { setError('Pick the repository, or type the full path of its folder.'); return; }
    const key = ticketText.trim() ? ticketKeyOf(ticketText) : null;
    if (ticketText.trim() && !key) { setError(TICKET_KEY_PROBLEM); return; }
    const ticket = key ? ticketOf(key, fromInbox, text) : undefined;
    // A name of his own that breaks the rule: its sentence is under the field and Start is off.
    if (key && branchProblem) return;
    setBusy(true);
    setError(null);
    try {
      const fromSession = from ? { id: from.id, mode: fromMode } : undefined;
      const options = { ...(level !== null ? { level } : {}), ...(asStack ? { stack: true } : {}), ...(allFable ? { all_fable: true } : {}), ...(auto ? { auto: true } : {}) };
      const r = await api.post<{ slug: string }>('/api/jobs', { description: text, kind, repoPath, model: (allFable ? FABLE : model) || undefined, options, fromSession, ticket, ...(key && sentName ? { name: sentName } : {}) });
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
        <p>The level sets the job’s <strong>options</strong> (stages, reviewers); fine-tune them later with <strong>Notes and options…</strong> in the job menu.{!hosted && <> To pick up something you already discussed with Claude Code, open <strong>Start from a past conversation</strong>.</>}</p>
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

          {hosted && hosted.laptops.length > 1 && (
            <fieldset className="field hosted-laptop-choice">
              <legend className="field-label">Which laptop starts it?</legend>
              {[...hosted.laptops].sort((a, b) => Number(b.online) - Number(a.online)).map((l) => (
                <OptionRow key={l.id} type="radio" name="start-laptop" value={String(l.id)} checked={laptopId === l.id} onChange={() => setLaptopId(l.id)}>
                  <span className="option-body">
                    <span className="option-title">{l.name}</span>
                    <span className="option-desc">{l.online ? 'Online: it starts in a moment.' : 'Off: it starts when the laptop is back.'}</span>
                  </span>
                </OptionRow>
              ))}
            </fieldset>
          )}

          {hosted && laptopId !== null && list.length === 0 ? (
            <p className="field-hint">This laptop hasn’t told {BRAND.name} about a repository yet, so it picks the one a ticket goes in. Add repositories in Settings → Repos on the laptop.</p>
          ) : (
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
                ...options.map((r) => ({ value: r.path, label: hosted ? <span className="repo-name">{r.name}</span> : <><span className="repo-name">{r.name}</span><span className="repo-path">{tilde(r.path)}</span></>, text: r.name })),
                ...(hosted ? [] : [{ value: OTHER, label: 'Another folder…' }]),
              ]}
            />
            {repos.state === 'error' && <p className="field-hint">Couldn’t list your repositories ({repos.message}). Type the folder’s path instead.</p>}
          </div>
          )}
          {!hosted && repo === OTHER && (
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

          {ticketKey && (hosted ? (
            <p className="field-hint">{`Branch · ${BRANCH_LATER}`}</p>
          ) : (
            <div className="field branch-field">
              <div className="branch-head">
                <label className="field-label" htmlFor={branchId}>Branch</label>
                {wholeBranch && <span className="branch-whole">{wholeBranch}</span>}
              </div>
              <div className="branch-line">
                {branchPrefix && <span className="branch-prefix" id={prefixId}>{branchPrefix}</span>}
                <TextInput
                  id={branchId}
                  value={branchName.value}
                  onChange={(e) => { askedByHand.current = 0; setBranchName({ value: e.target.value, by: 'own' }); }}
                  placeholder={branchPlaceholder}
                  spellCheck={false}
                  autoComplete="off"
                  aria-invalid={branchProblem || undefined}
                  aria-describedby={[branchPrefix ? prefixId : '', branchProblem ? ruleId : ''].filter(Boolean).join(' ') || undefined}
                  title={`The end of the job’s branch name. Type your own to keep it; leave it empty and ${BRAND.name} names it when the job starts.`}
                />
                <Button kind="quiet" size="sm" onClick={suggestAgain} disabled={asking || !nameBody} title="Ask for another name.">Suggest again</Button>
              </div>
              {branchProblem && <p className="field-problem" id={ruleId}>{BRANCH_RULE}</p>}
            </div>
          ))}

          <LevelPicker levels={meta?.levels} value={level} suggestion={suggestion} byHand={picked !== null} onPick={setPicked} disabled={busy} kind={kind} />

          {models.length > 0 && (
            <div className="field">
              <span className="field-label" aria-hidden="true">Foreman model</span>
              <Segmented
                label="Foreman model"
                className="model-segments"
                value={allFable ? FABLE : model}
                onChange={setModel}
                disabled={busy || allFable}
                options={models.map((m) => ({
                  value: m.id,
                  title: `Run this job’s Foreman on ${m.label}. You can change it for any later message.`,
                  label: <>{m.label}{m.note && <span className="sr-only">: {m.note}</span>}</>,
                }))}
              />
              <p className="field-hint">{allFable ? 'The whole job runs on Fable 5.2, so the Foreman does too.' : models.find((m) => m.id === model)?.note ?? '\u00a0'}</p>
            </div>
          )}

          <OptionRow type="checkbox" className="sheet-option" checked={allFable} onChange={(e) => setAllFable(e.target.checked)} disabled={busy} title={ALL_FABLE_HINT}>
            <span className="option-body" data-setting="all-fable">
              <span className="option-title">Run the whole job on Fable 5.2</span>
              <span className="option-desc">{ALL_FABLE_HINT}</span>
            </span>
          </OptionRow>

          <OptionRow type="checkbox" className="sheet-option" checked={asStack} onChange={(e) => setAsStack(e.target.checked)} disabled={busy} title="For a big ticket: the work is split into parts that are built side by side, then joined in order.">
            <span className="option-body" data-setting="run-as-stack">
              <span className="option-title">Run as a stack</span>
              <span className="option-desc">For a big ticket: the Foreman splits the work into parts that are built side by side, then joined in order. You check the parts on the Stack page before anything is built.</span>
            </span>
          </OptionRow>

          <AutoSwitch checked={auto} onChange={setAuto} disabled={busy} />

          {!hosted && <PastConversation picked={from} onPick={pick} mode={fromMode} onMode={setFromMode} canContinue={canContinue} />}
        </fieldset>

        <p className="sheet-fine">Runs with your own Claude Code login. {allFable ? 'Every worker and reviewer runs on Fable 5.2.' : 'Workers use the models set in their agent files.'}{meta?.demo ? ' Demo mode: a pretend Foreman answers; nothing real runs.' : ''}</p>
        {error && <p className="field-problem" role="alert">{error}</p>}
        <div className="sheet-actions">
          <Button onClick={onClose} disabled={busy} title="Close without starting anything.">Cancel</Button>
          <Button type="submit" kind="primary" busy={busy} busyLabel="Starting…" disabled={Boolean(ticketKey) && branchProblem} title="Start the job now. Its Foreman reads your request and replies in the conversation.">
            Start job
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
