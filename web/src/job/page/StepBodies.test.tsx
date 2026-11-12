// The open step's body for Spec, Plan, Build, Review and Ship (design 3.2, Part 3 Task 12): the
// prototype in the page, the plan's steps, the commits with their files, the reviewers and what they
// found, the three pull requests, and on an Auto job a line saying what Auto did at the step. Both
// on the laptop and on the website, and with a record from an older Starbase (none of the new
// facts). Invented jobs, commits and reviews only; no model, browser or network.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import type { AutoDecision, Job, Nudge, PrRow, StageView, StopId } from '../../api/types';
import { UiProvider } from '../../app/ui';
import { createStore, WorkshopContext } from '../../state/store';
import { job, SCREENS_ORIGIN, snapshot } from '../../state/test-fixtures';
import { flow, view as reviewView } from '../../views/Review/test-fixtures';
import { clearWireframes } from '../../panes/Preview/wireframes';
import { BuildStep, PlanStep, PlanSteps } from './BuildStep';
import { ReviewStep } from './ReviewStep';
import { ShipStep } from './ShipStep';
import { SpecStep } from './SpecStep';

const SLUG = 'pause-a-recurring-service';
const BRANCH = 'feature/orbit-900-pause-service';
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

function stage(stop: StopId, extra: Partial<StageView> = {}): StageView {
  return {
    slug: SLUG, stop, label: stop, state: 'now', stateWords: 'Now', since: null, stages: [], agents: [], finished: [],
    terminalApp: null, terminalApps: [], ...extra,
  };
}

const PLAN_V2 = {
  version: '2',
  steps: [
    { id: 'S1', name: 'Pause rules: which visits a pause covers', state: 'done' as const },
    { id: 'S2', name: 'Leave paused visits off the route', state: 'done' as const },
    { id: 'S3', name: 'The Pause dialog on the customer page', state: 'now' as const },
    { id: 'S4', name: 'No charge for a paused visit', state: 'next' as const },
  ],
};

const COMMITS = {
  head: BRANCH,
  commits: [
    {
      sha: 'b'.repeat(40), short: '7d03b18', author: 'Ann', date: ago(60), subject: 'Leave paused visits off the route', step: 'S2',
      files: [{ path: 'src/routes/buildRoute.ts', added: 22, removed: 4, isNew: false }, { path: 'src/routes/buildRoute.test.ts', added: 58, removed: 0, isNew: false }],
    },
    {
      sha: 'a'.repeat(40), short: 'a41c9e2', author: 'Ann', date: ago(120), subject: 'Pause rules: which visits a pause covers', step: 'S1',
      files: [{ path: 'src/services/pauseRules.ts', added: 96, removed: 0, isNew: true }],
    },
  ],
};
const CHANGE = {
  files: [{ path: 'src/routes/buildRoute.ts', added: 1, removed: 1 }],
  patchFiles: [{ path: 'src/routes/buildRoute.ts', lines: ['@@ -1 +1 @@', '-old', '+new'] }],
  truncated: false,
};

interface Setup {
  hosted?: boolean;
  jobExtra?: Partial<Job>;
  slug?: string;
  auto?: { entries: AutoDecision[] } | Error | null;
  commits?: unknown;
  review?: ReturnType<typeof reviewView> | null;
}

function setup(ui: (j: Job) => ReactNode, { hosted = false, jobExtra = {}, slug = SLUG, auto = null, commits = COMMITS, review = null }: Setup = {}) {
  const j = job(slug, 'running', { stage: 'implement', ...jobExtra });
  const store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: [j], meta: { token: 't', wireframesOrigin: SCREENS_ORIGIN } as never }) });
  const get = vi.fn(async (path: string): Promise<unknown> => {
    if (path.endsWith('/commits')) return commits;
    if (/\/commit\//.test(path)) return CHANGE;
    if (path.endsWith('/auto')) {
      if (auto instanceof Error) throw auto;
      return auto ? { on: true, stopped: null, tag: null, summary: ['', '', ''], ...auto } : null;
    }
    if (path === `/api/review/${slug}`) return review ? { ...review, github: null } : { slug, state: null };
    if (path === '/api/flow') return flow();
    return {};
  });
  const api = { get, post: vi.fn(async () => ({ ok: true })), hosted: () => hosted } as unknown as ApiClient;
  const utils = render(<WorkshopContext.Provider value={{ store, api }}><UiProvider>{ui(j)}</UiProvider></WorkshopContext.Provider>);
  return { ...utils, get, job: j };
}

afterEach(() => { cleanup(); localStorage.clear(); clearWireframes(); });

const HINT = 'Click through it like the real thing. Right-click (or press and hold) anywhere to pin a note. Decisions are on the Info tab.';

describe('Spec', () => {
  it('Spec shows the job’s prototype in the page with its hint; the website says where it opens', () => {
    const screens = { wireframes: { version: '2' } };
    const { container } = setup((j) => <SpecStep slug={SLUG} job={j} />, { jobExtra: screens });
    expect(screen.getByRole('heading', { name: 'Screens · v2' })).toBeInTheDocument();
    expect(screen.getByText(HINT)).toBeInTheDocument();
    expect(container.querySelector('iframe.screens-frame')).toHaveAttribute('src', `${SCREENS_ORIGIN}/job/${SLUG}/wireframes`);
    expect(screen.getByRole('link', { name: 'Review the screens' })).toHaveAttribute('href', `#/job/${SLUG}/screens`);
    cleanup();

    const site = setup((j) => <SpecStep slug={SLUG} job={j} />, { jobExtra: screens, hosted: true });
    expect(screen.getByRole('heading', { name: 'Screens · v2' })).toBeInTheDocument();
    expect(screen.getByText('The Screens page opens on your laptop.')).toBeInTheDocument();
    expect(site.container.querySelector('iframe')).toBeNull();
    expect(screen.queryByText(HINT)).toBeNull();
    cleanup();

    // A job with no screens draws nothing about them.
    const none = setup((j) => <SpecStep slug={SLUG} job={j} />);
    expect(none.container.querySelector('iframe')).toBeNull();
    expect(screen.queryByRole('heading', { name: /Screens/ })).toBeNull();
  });
});

describe('Plan and Build', () => {
  it('Plan lists the plan’s steps with no states', () => {
    setup(() => <PlanSteps plan={{ ...PLAN_V2, version: '1' }} states={false} />);
    expect(screen.getByRole('heading', { name: 'The plan’s steps · Plan v1' })).toBeInTheDocument();
    const items = within(screen.getByRole('list', { name: 'The plan’s steps' })).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['1Pause rules: which visits a pause covers', '2Leave paused visits off the route', '3The Pause dialog on the customer page', '4No charge for a paused visit']);
    for (const word of ['Done', 'Building now', 'Not yet']) expect(screen.queryByText(word)).toBeNull();
    cleanup();

    // The Plan step draws the same, on the website too; a plan with no numbered steps (or none known) draws no list.
    setup((j) => <PlanStep slug={SLUG} job={j} view={stage('plan', { plan: { ...PLAN_V2, version: '1' } })} />, { hosted: true });
    expect(screen.getByRole('heading', { name: 'The plan’s steps · Plan v1' })).toBeInTheDocument();
    expect(screen.queryByText('Building now')).toBeNull();
    cleanup();
    const older = setup((j) => <PlanStep slug={SLUG} job={j} view={stage('plan')} />);
    expect(older.container.querySelector('.sb-plan')).toBeNull();
  });

  it('Build lists the plan’s steps with the one being built now', async () => {
    setup((j) => <BuildStep slug={SLUG} job={j} view={stage('build', { plan: PLAN_V2 })} />);
    expect(screen.getByRole('heading', { name: 'The plan’s steps · Plan v2' })).toBeInTheDocument();
    const items = within(screen.getByRole('list', { name: 'The plan’s steps' })).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      '1Pause rules: which visits a pause coversDone',
      '2Leave paused visits off the routeDone',
      '3The Pause dialog on the customer pageBuilding now',
      '4No charge for a paused visitNot yet',
    ]);
    expect(items[2]).toHaveAttribute('aria-current', 'step');
    expect(items[0]).not.toHaveAttribute('aria-current');
    await screen.findByText('7d03b18');
  });

  it('a plan with no numbered steps says so and still lists the commits', async () => {
    setup((j) => <BuildStep slug={SLUG} job={j} view={stage('build', { plan: null })} />);
    expect(screen.getByText('This plan has no numbered steps. The commits below show the work.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'The plan’s steps' })).toBeNull();
    expect(await screen.findByRole('heading', { name: `Commits so far · 2 on ${BRANCH}` })).toBeInTheDocument();
    cleanup();

    // An older Starbase: no plan at all, and commits with no files. The rest still draws.
    const older = { commits: COMMITS.commits.map(({ files: _files, ...c }) => c) };
    setup((j) => <BuildStep slug={SLUG} job={j} view={stage('build')} />, { commits: older, jobExtra: { repo: { name: 'orbit', branch: BRANCH } } });
    expect(screen.getByText('The plan’s steps aren’t known for this job. The commits below show the work.')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: `Commits so far · 2 on ${BRANCH}` })).toBeInTheDocument();
    expect(screen.getByText('Leave paused visits off the route')).toBeInTheDocument();
    expect(screen.queryByText('Changed')).toBeNull();
    cleanup();

    // No commits yet: today's note.
    setup((j) => <BuildStep slug={SLUG} job={j} view={stage('build', { plan: PLAN_V2 })} />, { commits: { commits: [], note: 'No feature branch yet. Commits show up here once building starts.' } });
    expect(await screen.findByText('No feature branch yet. Commits show up here once building starts.')).toBeInTheDocument();
  });

  it('each commit lists its files, new or changed, with lines added and removed; opening it shows the change with its + and − kept', async () => {
    const { get } = setup((j) => <BuildStep slug={SLUG} job={j} view={stage('build', { plan: PLAN_V2 })} />);
    expect(await screen.findByRole('heading', { name: `Commits so far · 2 on ${BRANCH}` })).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith(`/api/job/${SLUG}/commits`);
    const commits = within(screen.getByRole('list', { name: 'Commits so far' })).getAllByRole('listitem').filter((li) => li.classList.contains('sb-commit'));
    expect(commits).toHaveLength(2);
    const first = commits[0];
    expect(first).toHaveTextContent('7d03b18');
    expect(first).toHaveTextContent('Leave paused visits off the route');
    expect(first).toHaveTextContent('1 h ago');
    const files = within(first).getAllByRole('listitem');
    expect(files.map((f) => f.textContent)).toEqual(['Changedsrc/routes/buildRoute.ts+22 −4', 'Changedsrc/routes/buildRoute.test.ts+58']);
    expect(within(commits[1]).getByRole('listitem')).toHaveTextContent('Newsrc/services/pauseRules.ts+96');

    const row = within(first).getByRole('button', { name: /Leave paused visits off the route/ });
    expect(row).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(await within(first).findByText('+new')).toHaveClass('is-add');
    expect(within(first).getByText('-old')).toHaveClass('is-del');
    expect(get).toHaveBeenCalledWith(`/api/job/${SLUG}/commit/${'b'.repeat(40)}`);
    fireEvent.click(row);
    expect(within(first).queryByText('+new')).toBeNull();
  });

  it('on the website Build shows the plan’s steps and says the commits are on the laptop', () => {
    const { get } = setup((j) => <BuildStep slug={SLUG} job={j} view={stage('build', { plan: PLAN_V2 })} />, { hosted: true });
    expect(screen.getByRole('heading', { name: 'The plan’s steps · Plan v2' })).toBeInTheDocument();
    expect(screen.getByText('Building now')).toBeInTheDocument();
    expect(screen.getByText('The commits show on your laptop.')).toBeInTheDocument();
    expect(get).not.toHaveBeenCalledWith(`/api/job/${SLUG}/commits`);
    expect(screen.queryByRole('alert')).toBeNull();
    cleanup();

    setup((j) => <BuildStep slug={SLUG} job={j} view={stage('build', { plan: null })} />, { hosted: true });
    expect(screen.getByText('This plan has no numbered steps.')).toBeInTheDocument();
    expect(screen.getByText('The commits show on your laptop.')).toBeInTheDocument();
  });
});

const REVIEWERS = {
  at: ago(30),
  reviewers: [
    { lens: 'feature-reviewer', name: 'Spec reviewer', model: 'Opus 5.5', rows: [] },
    {
      lens: 'feature-review-errors', name: 'Errors reviewer', model: 'Sonnet 5.5',
      rows: [
        { severity: 'major' as const, text: 'A pause that ended on a holiday had no next visit date.', status: 'fixed' as const },
        { severity: 'minor' as const, text: 'The dialog doesn’t say what happens to an invoice already sent.', status: 'not-doing' as const },
      ],
    },
    { lens: 'feature-review-tests', name: 'Tests reviewer', model: null, rows: [{ severity: 'minor' as const, text: 'There was no test for the longest pause, 12 weeks.', status: 'open' as const }] },
  ],
};

describe('Review', () => {
  it('Review lists each reviewer with its findings, each Fixed, Not doing or Open; a reviewer with none says No findings', () => {
    for (const hosted of [false, true]) {
      setup((j) => <ReviewStep slug={SLUG} job={j} view={stage('review', { review: REVIEWERS })} />, { hosted });
      expect(screen.getByRole('heading', { name: 'The reviewers and what they found' })).toBeInTheDocument();
      const cards = within(screen.getByRole('list', { name: 'The reviewers and what they found' })).getAllByRole('listitem').filter((li) => li.classList.contains('sb-reviewer'));
      expect(cards).toHaveLength(3);
      expect(cards[0]).toHaveTextContent('Spec reviewer');
      expect(cards[0]).toHaveTextContent('Opus 5.5');
      expect(cards[0]).toHaveTextContent('0 findings');
      expect(within(cards[0]).getByText('No findings.')).toBeInTheDocument();
      expect(cards[1]).toHaveTextContent('Errors reviewer');
      expect(cards[1]).toHaveTextContent('2 findings');
      const rows = within(cards[1]).getAllByRole('listitem');
      expect(rows.map((r) => r.textContent)).toEqual(['FixedA pause that ended on a holiday had no next visit date.', 'Not doingThe dialog doesn’t say what happens to an invoice already sent.']);
      expect(cards[2]).toHaveTextContent('1 finding');
      expect(cards[2]).not.toHaveTextContent('1 findings');
      expect(within(cards[2]).getByRole('listitem')).toHaveTextContent('OpenThere was no test for the longest pause, 12 weeks.');
      cleanup();
    }

    // A review with no reviewers: No findings. An older Starbase (review not known): nothing about findings, and nothing throws.
    setup((j) => <ReviewStep slug={SLUG} job={j} view={stage('review', { review: { at: null, reviewers: [] } })} />);
    expect(screen.getByText('No findings.')).toBeInTheDocument();
    cleanup();
    setup((j) => <ReviewStep slug={SLUG} job={j} view={stage('review')} />);
    expect(screen.queryByText(/finding/i)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'The reviewers and what they found' })).toBeNull();
  });

  it('the review walkthrough folds under Review only when there is one', () => {
    setup((j) => <ReviewStep slug={SLUG} job={j} view={stage('review', { review: REVIEWERS })} />, { jobExtra: { walkthrough: { updatedAt: ago(10), size: 2000, url: null } } });
    const fold = screen.getByText('Review walkthrough', { selector: '.fold-name' }).closest('details');
    expect(fold).not.toBeNull();
    cleanup();
    setup((j) => <ReviewStep slug={SLUG} job={j} view={stage('review', { review: REVIEWERS })} />);
    expect(screen.queryByText('Review walkthrough')).toBeNull();
  });
});

const PRS: PrRow[] = [
  { n: 1, number: 412, title: 'Pause a recurring service (ORBIT-900)', url: 'https://github.com/acme/orbit/pull/412', state: 'open', review: 'changes', checks: 'running', openedAt: ago(20) },
  { n: 2, number: null, title: null, url: null, state: 'not-started', review: null, checks: null, openedAt: null },
  { n: 3, number: null, title: null, url: null, state: 'not-started', review: null, checks: null, openedAt: null },
];
const prRows = () => within(screen.getByRole('list', { name: 'The pull requests' })).getAllByRole('listitem');

describe('Ship', () => {
  it('Ship lists three pull requests with where each goes and its state in words', () => {
    for (const hosted of [false, true]) {
      setup((j) => <ShipStep slug={SLUG} job={j} view={stage('ship', { prs: PRS })} />, { hosted, jobExtra: { stage: 'pr1' } });
      expect(screen.getByRole('heading', { name: 'The pull requests' })).toBeInTheDocument();
      const [one, two, three] = prRows();
      expect(one).toHaveTextContent('PR #1 · Pause a recurring service (ORBIT-900)');
      expect(one).toHaveTextContent('From your fork into the team’s feature branch');
      expect(within(one).getByText('Open, changes asked for')).toBeInTheDocument();
      expect(within(one).getByText('Checks running · opened 20 min ago')).toBeInTheDocument();
      const link = within(one).getByRole('link', { name: 'Open on GitHub' });
      expect(link).toHaveAttribute('href', 'https://github.com/acme/orbit/pull/412');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noreferrer');
      expect(two).toHaveTextContent('PR #2 · Into staging');
      expect(two).toHaveTextContent('After PR #1 is merged, with its own go-ahead');
      expect(within(two).getByText('Not started')).toBeInTheDocument();
      expect(within(two).queryByRole('link')).toBeNull();
      expect(three).toHaveTextContent('PR #3 · Into main');
      expect(three).toHaveTextContent('After staging is checked');
      expect(within(three).getByText('Not started')).toBeInTheDocument();
      cleanup();
    }

    // Each state in words; no checks and no time: neither is drawn; a URL that isn't http(s) has no link.
    const states: [PrRow, string][] = [
      [{ n: 1, state: 'open', review: null }, 'Open, waiting for a review'],
      [{ n: 1, state: 'open', review: 'waiting' }, 'Open, waiting for a review'],
      [{ n: 1, state: 'open', review: 'approved', checks: 'passed' }, 'Open, approved'],
      [{ n: 1, state: 'draft' }, 'Draft'],
      [{ n: 1, state: 'merged' }, 'Merged'],
      [{ n: 1, state: 'closed' }, 'Closed'],
    ];
    for (const [pr, words] of states) {
      setup((j) => <ShipStep slug={SLUG} job={j} view={stage('ship', { prs: [{ ...pr, url: 'javascript:alert(1)' }, PRS[1], PRS[2]] })} />);
      const [one] = prRows();
      expect(within(one).getByText(words)).toBeInTheDocument();
      expect(one).toHaveTextContent(/^PR #1From your fork/);
      expect(within(one).queryByRole('link')).toBeNull();
      if (pr.checks === 'passed') expect(within(one).getByText('Checks passed')).toBeInTheDocument();
      expect(one).not.toHaveTextContent('opened');
      cleanup();
    }
    setup((j) => <ShipStep slug={SLUG} job={j} view={stage('ship', { prs: [{ n: 1, state: 'open', checks: 'failed' }, PRS[1], PRS[2]] })} />);
    expect(within(prRows()[0]).getByText('Checks failed')).toBeInTheDocument();
    cleanup();

    // An older Starbase: no pull requests known. It says so, and the rest draws.
    setup((j) => <ShipStep slug={SLUG} job={j} view={stage('ship')} />);
    expect(screen.getByText('The pull requests aren’t known for this job yet.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'The pull requests' })).toBeNull();
  });

  it('the review panel and the nudges are still under them', async () => {
    const nudge: Nudge = { id: 'pr1-merged', kind: 'ask', title: 'PR #1 is merged: tell the Foreman?', text: 'It still asks you to merge it.', link: null, action: { send: 'PR #1 is merged.' }, afterLine: false };
    const { container } = setup((j) => <ShipStep slug="feedback-api" job={j} view={stage('ship', { prs: PRS })} />, { slug: 'feedback-api', review: reviewView('asked'), jobExtra: { stage: 'pr2', nudges: [nudge], auto: { on: true, ran: true } } });
    const panel = await screen.findByRole('region', { name: 'Round 1 · PR #2' });
    expect(within(screen.getByRole('region', { name: 'GitHub' })).getByText('PR #1 is merged: tell the Foreman?')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'GitHub' })).getByRole('button', { name: 'Yes, tell the Foreman' })).toBeEnabled();
    // In that order: the pull requests, then the review panel, then the nudges.
    const list = screen.getByRole('list', { name: 'The pull requests' });
    expect(list.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(panel.compareDocumentPosition(screen.getByRole('region', { name: 'GitHub' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Nothing in the review panel is turned off because the job is on Auto.
    expect(within(panel).queryAllByRole('button').filter((b) => (b as HTMLButtonElement).disabled)).toEqual([]);
    expect(container.querySelector('.sb-prs')).not.toBeNull();
  });
});

describe('Auto', () => {
  const ENTRIES: AutoDecision[] = [
    { at: ago(5), stage: 'Plan', chose: 'step 1 of the plan changes the database, and only you approve that', asked: '', why: '', kind: 'stop', stop: 'plan' },
    { at: ago(30), stage: 'Spec', chose: 'Approved', asked: 'Spec v1 ready', why: 'It matches the ticket.', kind: 'approve', stop: 'spec' },
    { at: ago(40), stage: 'Spec', chose: 'Up to 12 weeks', asked: 'How long can a pause be?', why: 'The ticket says so.', kind: 'answer', stop: 'spec' },
    { at: ago(50), stage: 'Spec', chose: 'Allowed', asked: 'npm test', why: '', kind: 'allow', stop: 'build' },
  ];
  const AUTO = { auto: { on: true, ran: true } };
  const SPEC_LINE = 'Auto answered this step’s question and approved spec v1. What Auto decided has the reasons.';
  const STOP_LINE = 'Auto stopped here: step 1 of the plan changes the database, and only you approve that.';
  const specView = stage('spec', { docs: [{ file: 'spec', name: 'Product spec', group: 'plan', version: '1', updatedAt: null, size: 10, type: 'md' }] });

  it('an Auto job says what Auto did at a step', async () => {
    for (const hosted of [false, true]) {
      setup((j) => <SpecStep slug={SLUG} job={j} view={specView} />, { auto: { entries: ENTRIES }, jobExtra: AUTO, hosted });
      expect(await screen.findByText(SPEC_LINE)).toBeInTheDocument();
      expect(screen.queryByText(/Auto stopped here/)).toBeNull();
      cleanup();
    }

    setup((j) => <PlanStep slug={SLUG} job={j} view={stage('plan', { plan: { ...PLAN_V2, version: '1' } })} />, { auto: { entries: ENTRIES }, jobExtra: AUTO });
    expect(await screen.findByText(STOP_LINE)).toBeInTheDocument();
    cleanup();

    // Build: only an allowed permission, so no line; Review: no entries, no line.
    const build = setup((j) => <BuildStep slug={SLUG} job={j} view={stage('build', { plan: PLAN_V2 })} />, { auto: { entries: ENTRIES }, jobExtra: AUTO });
    await waitFor(() => expect(build.get).toHaveBeenCalledWith(`/api/job/${SLUG}/auto`));
    await screen.findByText('7d03b18');
    expect(screen.queryByText(/^Auto /)).toBeNull();
    cleanup();
    const review = setup((j) => <ReviewStep slug={SLUG} job={j} view={stage('review', { review: REVIEWERS })} />, { auto: { entries: ENTRIES }, jobExtra: AUTO });
    await waitFor(() => expect(review.get).toHaveBeenCalledWith(`/api/job/${SLUG}/auto`));
    await act(async () => {});
    expect(screen.queryByText(/^Auto /)).toBeNull();
    cleanup();

    // Ship on an Auto job: where Auto stops.
    setup((j) => <ShipStep slug={SLUG} job={j} view={stage('ship', { prs: PRS })} />, { auto: { entries: ENTRIES }, jobExtra: AUTO });
    expect(screen.getByText('Auto stops once PR #1 is open. It never merges.')).toBeInTheDocument();
    cleanup();
    const atShip: AutoDecision = { at: ago(1), stage: 'PR #1', chose: 'the pull request needs your go-ahead.', asked: '', why: '', kind: 'stop', stop: 'ship' };
    setup((j) => <ShipStep slug={SLUG} job={j} view={stage('ship', { prs: PRS })} />, { auto: { entries: [atShip, ...ENTRIES] }, jobExtra: AUTO });
    expect(await screen.findByText('Auto stopped here: the pull request needs your go-ahead.')).toBeInTheDocument();
    expect(screen.queryByText('Auto stops once PR #1 is open. It never merges.')).toBeNull();
    cleanup();

    // A stop that is no longer the newest entry: the step's decisions show instead.
    const later: AutoDecision = { at: ago(1), stage: 'Plan', chose: 'Approved', asked: 'Plan v1 ready', why: '', kind: 'approve', stop: 'plan' };
    setup((j) => <PlanStep slug={SLUG} job={j} view={stage('plan', { plan: { ...PLAN_V2, version: '1' } })} />, { auto: { entries: [later, ...ENTRIES] }, jobExtra: AUTO });
    expect(await screen.findByText('Auto approved this step. What Auto decided has the reasons.')).toBeInTheDocument();
    expect(screen.queryByText(STOP_LINE)).toBeNull();
  });

  it('no Auto line from an older record, a failed read, or a job Auto never ran on', async () => {
    const older = ENTRIES.map(({ kind: _kind, stop: _stop, ...e }) => e);
    let s = setup((j) => <SpecStep slug={SLUG} job={j} view={specView} />, { auto: { entries: older }, jobExtra: AUTO });
    await waitFor(() => expect(s.get).toHaveBeenCalledWith(`/api/job/${SLUG}/auto`));
    await act(async () => {});
    expect(screen.queryByText(/^Auto /)).toBeNull();
    cleanup();

    s = setup((j) => <PlanStep slug={SLUG} job={j} view={stage('plan', { plan: PLAN_V2 })} />, { auto: new Error('Not found'), jobExtra: AUTO });
    await waitFor(() => expect(s.get).toHaveBeenCalledWith(`/api/job/${SLUG}/auto`));
    await act(async () => {});
    expect(screen.queryByText(/^Auto /)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('heading', { name: 'The plan’s steps · Plan v2' })).toBeInTheDocument();
    cleanup();

    s = setup((j) => <PlanStep slug={SLUG} job={j} view={stage('plan', { plan: PLAN_V2 })} />, { auto: { entries: ENTRIES } });
    await act(async () => {});
    expect(s.get).not.toHaveBeenCalledWith(`/api/job/${SLUG}/auto`);
    expect(screen.queryByText(/^Auto /)).toBeNull();
  });
});
