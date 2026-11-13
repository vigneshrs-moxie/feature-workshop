// The new job page's header (plan Task 8): one row. The ticket key (a link to Orbit when the page knows
// its address), the title, ONE state word (Needs you, Working, Waiting on GitHub, Paused, Done); at the
// right, dim, the level, the repository and the cost (over 10 cents, as the old page shows it); then the
// Auto switch with its word, and the ⋯ menu with everything rare.
//
// The Auto switch is the shared one (job/AutoSwitch.tsx), optimistic: it flips at once and flips back
// with one plain line if the server refuses (the website still queues it for the laptop, as today).
//
// The ⋯ menu opens what today's page opens, through the same handlers:
//   Mark done or dropped        the close-job sheet (ui.openSheet, as panes/Foreman/JobHeader's job menu)
//   Reopen / Keep it open       POST /reopen (app/jobActions reopenJob), on a job marked done or dropped
//   Notes and options           the job drawer (ui.openSheet job-drawer); the n key no longer opens it here
//   Change model                the change-model sheet, once the Foreman has a session
//   Permissions for this job    the job's own setting (app/jobActions setJobPolicy), a tick on the one in force
//   Copy decisions              job/CopyDecisions's panel
//   How this page works         the page's three cards (components/page/Page Guide)
//   Open the folder in a terminal  POST /api/job/:slug/local { action: 'open', what: 'terminal' } (as StepPanel)
//   Back to the old job page    the page switch (switch.ts)
// On the website the laptop's items are not there (the website answers them "on your laptop"): it keeps
// Copy decisions, How this page works and the page switch.
//
// Lines sit in the row itself, left of Auto, never over the panes: what a menu item did (gone after a
// few seconds) or why it could not (until Dismiss), Auto's refusal (until Dismiss), and on the website
// the queued Auto change (waiting, on its way, refused), read live from the Jobs snapshot's row. While
// one shows on a laptop, the dim facts make room for it.
//
// First paint from the Jobs snapshot's row (the `job` prop), so the key, the title and the state word do
// not move when the payload lands.

import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Job, Run } from '../../api/types';
import { reopenJob, setJobPolicy } from '../../app/jobActions';
import { MenuButton, type MenuEntry } from '../../app/Menu';
import { useUi } from '../../app/ui';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { Guide, type GuideSpec } from '../../components/page/Page';
import { autoBlockedReason, autoModeOf, HARD_LINES_NOTE, POLICIES, policyLabel } from '../../components/permissions/policies';
import { laneOf } from '../../home/JobsPage';
import { AutoSwitch } from '../../job/AutoSwitch';
import { CopyDecisions } from '../../job/CopyDecisions';
import { formatCost, isActiveRun } from '../../panes/Foreman/thread';
import { DecisionsTab } from '../../panes/Preview/DecisionsTab';
import { jobBySlug } from '../../state/reducer';
import { useWorkshop } from '../../state/store';
import { backToOldJobPage } from '../switch';
import type { JobState } from '../types';
import { useJob } from '../useJob';

export const STATE_WORDS: Record<JobState, string> = {
  'needs-you': 'Needs you', working: 'Working', 'waiting-github': 'Waiting on GitHub', paused: 'Paused', done: 'Done',
};

/** The snapshot row's state in the payload's five words (interfaces §0.2). */
export function stateFromRow(job: Job): JobState {
  const lane = laneOf(job);
  if (lane === 'needs-you') return 'needs-you';
  if (lane === 'working') return job.limitPaused ? 'paused' : 'working';
  if (lane === 'in-review' || lane === 'ready') return 'waiting-github';
  if (lane === 'done') return 'done';
  return 'paused';
}

/** The ticket key a slug names, as the server reads it (dashboard/lib/orbit.js slugTicketKey), so the
 *  first paint has the key the payload will bring and the title does not move when it lands. */
export function slugKey(slug: string): string | null {
  const m = /^orbit-(\d{1,9})(?:-|$)/i.exec(slug);
  return m ? `ORBIT-${Number(m[1])}` : null;
}

/** How this page works: the three things to know, in the shared guide's cards. */
export const JOB_PAGE_GUIDE: GuideSpec = {
  id: 'job-page-new',
  title: 'How this job page works',
  done: 'Got it',
  cards: [
    { icons: ['hand'], title: 'Your move is at the top', say: 'When the job waits for you, the card on the left says what it needs, with Go, Reply and Send back.' },
    { icons: ['list'], title: 'Seven steps, one line each', say: 'Click a step to see what it made. Whatever you open shows on the right, and [ and ] move between steps.' },
    { icons: ['message'], title: 'The conversation is one click away', say: 'Conversation lists every message, one line each. / searches it; g then c opens it.' },
  ],
};

const COST_TITLE = 'Level, repository, and what this job has cost so far.';

export const Header = memo(function Header({ job }: { job: Job | null }) {
  const slug = useJob((s) => s.slug);
  const title = useJob((s) => s.payload?.title) ?? (job?.title || job?.slug || '');
  const key = useJob((s) => s.payload?.key) ?? (job ? slugKey(job.slug) : null);
  const keyUrl = useJob((s) => s.payload?.keyUrl ?? null);
  const state = useJob((s) => s.payload?.state) ?? (job ? stateFromRow(job) : null);
  const facts = useJob((s) => s.payload?.facts ?? null);
  const level = facts ? facts.level : job?.level ?? null;
  const repo = facts ? facts.repo : job?.repo?.name ?? null;
  // The cost as the old page shows it: only over 10 cents (a row with no cost records yet shows none).
  const usd = facts ? facts.cost : job?.cost?.source === 'none' ? null : job?.cost?.totalUsd ?? null;
  const cost = typeof usd === 'number' && usd > 0.1 ? formatCost(usd) : null;
  const levelWord = level !== null && level !== undefined ? `L${level}` : null;
  const dim = [levelWord, repo, cost].filter(Boolean).join(' · ');
  const [note, setNote] = useState<HeadNoteWords | null>(null);
  return (
    <header className="jp2-head">
      <a className="jp2-jobs" href="#/"><Icon name="chevron-left" size={16} />Jobs</a>
      <div className="jp2-head-main">
        {key && (keyUrl ? <a className="jp2-key" href={keyUrl} target="_blank" rel="noreferrer" title="Open the ticket in Orbit.">{key}</a> : <span className="jp2-key">{key}</span>)}
        <h1 className="jp2-title">{title}</h1>
        {state && <span className="jp2-state">{STATE_WORDS[state]}</span>}
      </div>
      <span className="jp2-spacer" />
      {dim && <span className="jp2-facts" title={cost ? COST_TITLE : undefined}>{dim}</span>}
      {note && <HeadNote note={note} onClear={setNote} />}
      <HeaderAuto slug={slug} job={job} />
      <MoreMenu slug={slug} job={job} onNote={setNote} />
    </header>
  );
});

interface HeadNoteWords { text: string; bad: boolean }
/** How long a menu item's own result stays (a refusal stays until Dismiss). */
export const NOTE_MS = 6000;

/** What a menu item did, or why it could not: one line in the row, with Dismiss. */
function HeadNote({ note, onClear }: { note: HeadNoteWords; onClear(n: null): void }) {
  useEffect(() => {
    if (note.bad) return undefined;
    const t = setTimeout(() => onClear(null), NOTE_MS);
    return () => clearTimeout(t);
  }, [note, onClear]);
  return (
    <p className="jp2-head-note" role={note.bad ? 'alert' : 'status'}>
      <span title={note.text}>{note.text}</span>
      <Button kind="quiet" size="sm" iconOnly icon="x" aria-label="Dismiss" title="Hide this line." onClick={() => onClear(null)} />
    </p>
  );
}

/** The shared Auto switch, optimistic, with its word; on the website with the job's queued change. */
const HeaderAuto = memo(function HeaderAuto({ slug, job }: { slug: string; job: Job | null }) {
  const { store } = useWorkshop();
  const fromPayload = useJob((s) => (s.payload ? s.payload.auto : undefined));
  const auto = fromPayload === undefined ? job?.auto ?? null : fromPayload;
  // The website's Jobs rows carry the Auto change queued for the laptop (hosted/site/routes-mirror.js);
  // read live, as a string, so only a change to it redraws the switch. Never set on the laptop.
  const queuedJson = useSyncExternalStore(store.subscribe, () => JSON.stringify((jobBySlug(store.getState(), slug) as { autoQueued?: unknown } | null)?.autoQueued ?? null));
  const switchJob = useMemo(() => ({ slug, auto: auto ?? undefined, autoQueued: JSON.parse(queuedJson) as unknown }) as Pick<Job, 'slug' | 'auto'>, [slug, auto, queuedJson]);
  return (
    <div className="jp2-auto">
      <AutoSwitch job={switchJob} word tagLine={false} optimistic short />
    </div>
  );
});

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The ⋯ menu: everything rare, through today's handlers. */
const MoreMenu = memo(function MoreMenu({ slug, job, onNote }: { slug: string; job: Job | null; onNote(n: HeadNoteWords | null): void }) {
  const { api, store } = useWorkshop();
  const ui = useUi();
  const hosted = Boolean(api.hosted?.());
  const closed = useJob((s) => (s.payload ? s.payload.closed !== null : Boolean(job?.closed)));
  const closedEarlier = Boolean(job?.closedEarlier);
  const running = useJob((s) => isActiveRun((s.payload?.run ?? null) as Run | null));
  const local = useJob((s) => s.payload?.local ?? null);
  const dir = local?.dir ?? null;
  const fromPayload = local?.policyOverride ?? null;
  // This job's own setting and yours, as the old menu reads them (the live settings win once the folder is known).
  const override = useSyncExternalStore(store.subscribe, () => {
    const settings = store.getState().meta?.settings;
    return dir && settings?.jobPolicy ? settings.jobPolicy[dir] ?? null : fromPayload;
  });
  const global = useSyncExternalStore(store.subscribe, () => store.getState().meta?.settings?.policy ?? 'hands-off');
  const blocked = useSyncExternalStore(store.subscribe, () => autoBlockedReason(autoModeOf(store.getState().meta?.settings)));
  const [open, setOpen] = useState<'copy' | 'guide' | null>(null);
  const shut = useCallback(() => setOpen(null), []);
  const busy = useRef(false);

  /** One menu action at a time (the old menu's busy): a second one while a post is out does nothing. */
  async function act(fn: () => Promise<string | void>) {
    if (busy.current) return;
    busy.current = true;
    onNote(null);
    try {
      const said = await fn();
      if (said) onNote({ text: said, bad: false });
    } catch (err) {
      onNote({ text: messageOf(err), bad: true });
    } finally {
      busy.current = false;
    }
  }

  const entries: MenuEntry[] = [];
  if (!hosted) {
    if (!closed) {
      entries.push({
        kind: 'action', id: 'close', label: 'Mark done or dropped', disabled: running,
        hint: running ? 'The Foreman is replying. Stop the reply first, then mark the job.' : 'Move it to Done, as done or dropped, with an optional note. Nothing is deleted and you can reopen it any time.',
        run: () => ui.openSheet({ kind: 'close-job', slug, worktree: local?.worktree ?? null }),
      });
    }
    if (closed || closedEarlier) {
      entries.push({
        kind: 'action', id: 'reopen', label: closed ? 'Reopen' : 'Keep it open',
        hint: closed ? 'Put it back among the open jobs. Nothing else changes; the Foreman isn’t contacted.' : 'It was marked done or dropped earlier and has changed since. Keep it open for good.',
        run: () => void act(() => reopenJob(api, slug)),
      });
    }
    entries.push({
      kind: 'action', id: 'notes', label: 'Notes and options',
      hint: 'Open this job’s notes (notes.md, read by the Foreman every session) and its options: level, stages, reviewers, testing, Fable second looks and models.',
      run: () => ui.openSheet({ kind: 'job-drawer', slug }),
    });
    if (local?.started) {
      entries.push({
        kind: 'action', id: 'model', label: 'Change model', disabled: running,
        hint: running ? 'The Foreman is replying. Stop the reply first.' : 'The Foreman’s model is fixed for a job. Another one starts the job again from step one; you see what that moves before you agree.',
        run: () => ui.openSheet({ kind: 'change-model', slug }),
      });
    }
    entries.push({
      kind: 'choices', id: 'policy', label: 'Permissions for this job',
      options: [
        {
          id: 'follow', label: `Follow my setting (${policyLabel(global)})`, checked: override === null,
          hint: 'Use your global setting from Settings, and follow it when you change it.',
          run: () => void act(async () => { await setJobPolicy(api, store, slug, dir, null); }),
        },
        ...POLICIES.map((p) => {
          const off = p.id === 'auto' && blocked !== null && override !== 'auto';
          return {
            id: p.id, label: p.label, checked: override === p.id, disabled: off,
            hint: off ? `Not available: ${blocked}` : `${p.hint} Only this job; it applies at once, also to a reply in progress. ${HARD_LINES_NOTE}`,
            run: () => void act(async () => { await setJobPolicy(api, store, slug, dir, p.id); }),
          };
        }),
      ],
    });
  }
  entries.push({ kind: 'action', id: 'copy', label: 'Copy decisions', hint: 'Copy the product decisions as a plain list, to paste into the Orbit ticket.', run: () => setOpen('copy') });
  entries.push({ kind: 'action', id: 'guide', label: 'How this page works', hint: 'The three things to know about this page.', run: () => setOpen('guide') });
  if (!hosted) {
    entries.push({
      kind: 'action', id: 'terminal', label: 'Open the folder in a terminal', hint: 'Open a terminal in the job’s folder (its worktree).',
      run: () => void act(async () => {
        await api.post(`/api/job/${encodeURIComponent(slug)}/local`, { action: 'open', what: 'terminal' });
        return 'Opened the job’s folder in a terminal.';
      }),
    });
  }
  entries.push({ kind: 'sep', id: 'sep-page' });
  entries.push({ kind: 'action', id: 'old-page', label: 'Back to the old job page', hint: 'Show this job on the job page you had before. You can switch again from its job menu.', run: backToOldJobPage });

  return (
    <>
      <MenuButton label="More for this job" hint="Rare things for this job." icon="dots" className="jp2-menu" entries={entries} />
      {open === 'copy' && <CopyDecisions slug={slug} all={<DecisionsTab slug={slug} active copy={false} />} onClose={shut} />}
      {open === 'guide' && <Guide spec={JOB_PAGE_GUIDE} onClose={shut} />}
    </>
  );
});
