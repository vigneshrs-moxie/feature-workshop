// The bar at the top of a job (design 3.3; the owner's requirement): who is working and on what,
// evidence being recorded, what Auto is doing, and what was just sent. On every step that waits for
// him, on Auto jobs too, the bar has Send back, Reply and Go, all of them pressable; the two states
// that keep today's rule (a permission card takes the bar's place; a status card has Reply only)
// say so where they are tested. Invented jobs and requests only; no model calls.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../api/client';
import type { Gate, Job, JobDetail, Permission, ThreadItem } from '../api/types';
import { installKeyListener } from '../app/keyRegistry';
import { UiProvider } from '../app/ui';
import { useJobConversation } from '../panes/Foreman/ForemanPane';
import { jobBySlug } from '../state/reducer';
import { createStore, useWorkshopState, WorkshopContext, type Store } from '../state/store';
import { ev, job, permission, snapshot } from '../state/test-fixtures';
import type { QueuedView } from '../views/Hosted/QueuedDecision';
import { AUTO_DECIDING_NOTE } from './autoLine';
import { NextStep, useSentShown } from './NextStep';
import { sentLine, SENT_WORDS } from './sentView';

const NOW = new Date().toISOString();
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

const GATE: Gate = {
  briefNumber: 2, briefFile: 'briefs/002-plan.md', headline: 'Plan v2 ready', stage: 'plan', nextStage: 'implement', nextProposed: 'Build step 1',
  questions: [], decided: [], versions: null, raisedVersions: null, stale: false, waitingSince: '2026-10-21T09:00:00Z', runActive: false, parked: false,
  level: 1, suggestedLevel: null, levelReason: null, usage: null,
};
const TWO_QUESTIONS: Gate = {
  ...GATE,
  questions: [
    { id: '1', text: 'Keep the old column?', recommendation: null, options: [{ id: 'a', label: 'Yes' }, { id: 'b', label: 'No' }] },
    { id: '2', text: 'Show it on the phone?', recommendation: null, options: [{ id: 'a', label: 'Yes' }, { id: 'b', label: 'No' }] },
  ],
} as Gate;

/** What the test's server knows (as GET /api/job/:slug returns it). */
const server = {
  store: null as Store | null, answered: [] as number[], gate: undefined as Gate | null | undefined,
  thread: [] as ThreadItem[], page: undefined as JobDetail['page'], queued: null as QueuedView | null,
};

/** The bar as a page draws it, and what useSentShown says beside it. */
function Bar({ job: j, onWatch }: { job: Job; onWatch?: () => void }) {
  const conversation = useJobConversation(j);
  const shown = useSentShown(j, conversation);
  return (
    <>
      <NextStep job={j} conversation={conversation} now={new Date()} onWatch={onWatch} />
      <output data-sent-shown>{shown === null ? 'none' : shown.kind ?? 'unknown'}</output>
    </>
  );
}
function Host({ slug, onWatch }: { slug: string; onWatch?: () => void }) {
  const j = jobBySlug(useWorkshopState(), slug);
  return j ? <Bar job={j} onWatch={onWatch} /> : null;
}

function setup({ jobs = [job('alpha', 'idle', { stage: 'plan' })], permissions = [] as Permission[], gate = null as Gate | null, answered = [] as number[], thread = [] as ThreadItem[], page = undefined as JobDetail['page'], hosted = false, onWatch = undefined as (() => void) | undefined, post = vi.fn(async (_path: string, _body?: unknown): Promise<unknown> => ({ ok: true })) } = {}) {
  const store: Store = createStore();
  server.store = store;
  server.answered = [...answered];
  server.gate = undefined;
  server.thread = thread;
  server.page = page;
  server.queued = null;
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs, permissions, meta: { token: 't', settings: { play: { mode: 'subtle' } } } as never }) });
  const detail = (s: string): JobDetail => ({ slug: s, thread: server.thread, threadMore: false, gate: server.gate === undefined ? gate : server.gate, answeredBriefs: [...server.answered], heldReply: null, options: { level: 1 }, page: server.page, queued: server.queued } as JobDetail);
  const get = vi.fn(async (path: string): Promise<unknown> => {
    if (path.endsWith('/evidence')) return { runs: [] };
    if (path.startsWith('/api/review/')) return null;
    return detail(path.split('/')[3]);
  });
  const api = { get, post, ...(hosted ? { hosted: () => true } : {}) } as unknown as ApiClient;
  const utils = render(<WorkshopContext.Provider value={{ store, api }}><UiProvider><Host slug="alpha" onWatch={onWatch} /></UiProvider></WorkshopContext.Provider>);
  return { ...utils, get, post, store };
}

/**
 * The gate POST as the server answers it: `sent: true` with a started run (its event reaches the
 * page unless `runEvent` is false), and a deciding answer answers the brief.
 */
const sentPost = ({ runEvent = true } = {}) => {
  let n = 0;
  return vi.fn(async (path: string, body?: unknown): Promise<unknown> => {
    if (path !== '/api/job/alpha/gate') return { ok: true };
    const b = (body ?? {}) as { kind?: string; briefNumber?: number | null };
    if ((b.kind === 'approve' || b.kind === 'changes') && typeof b.briefNumber === 'number') server.answered.push(b.briefNumber);
    const run = { id: `r_sent_${++n}`, slug: 'alpha', status: 'running' };
    if (runEvent) server.store?.dispatch({ type: 'event', event: ev(100 + n, 'run', 'alpha', run) });
    return { ok: true, sent: true, text: 'sent', run };
  });
};

const bar = () => screen.getByRole('region', { name: 'Next step' });
const live = () => document.querySelector('[data-next-live]')!;
const shownKind = () => document.querySelector('[data-sent-shown]')!.textContent;
/** The three calls, by their words in Play subtle. */
const threeCalls = () => [
  within(bar()).getByRole('button', { name: /^No go: send back/ }),
  within(bar()).getByRole('button', { name: 'Reply' }),
  within(bar()).getByRole('button', { name: /^Go: / }),
];
/** The gate card is drawn under the bar (the job's detail is in), so the bar has its calls. */
const gateShown = () => waitFor(() => expect(document.querySelector('[data-gate="approve"]')).not.toBeNull());
const waiting = (extra: Partial<Job> = {}) => [job('alpha', 'needs-you', { stage: 'plan', lane: 'needs-you', waitingFor: 'approval', headline: 'The plan is ready. Start building?', ...extra })];

let off = () => {};
beforeEach(() => { off = installKeyListener(); });
afterEach(() => { off(); cleanup(); localStorage.clear(); window.location.hash = ''; });

describe('the bar while nothing waits for you', () => {
  it('while the crew works the bar names who and what, with no button', () => {
    setup({ jobs: [job('alpha', 'running', { stage: 'implement', lane: 'working', nowDoing: [{ who: 'feature-implementer', name: 'Builder', doing: 'Building step 3 of 6: the Pause dialog', model: 'Sonnet 5.5', since: ago(12) }] })] });
    expect(bar().querySelector('.next-head')).toHaveTextContent('The Builder is building step 3 of 6: the Pause dialog');
    expect(bar().querySelector('.next-sub')).toHaveTextContent('Builder on Sonnet 5.5, 12 min on this step. The Foreman waits for it. Nothing for you to do until the tests.');
    expect(within(bar()).queryByRole('button')).toBeNull();
    expect(bar()).not.toHaveTextContent('Nothing to do right now');
    cleanup();
    // The Foreman itself, at another step: it waits for nobody, and the ending is "right now".
    setup({ jobs: [job('alpha', 'running', { stage: 'plan', lane: 'working', nowDoing: [{ who: 'conductor', name: 'Foreman', doing: 'Reading your message', model: 'Opus 5.5', since: ago(12) }] })] });
    expect(bar().querySelector('.next-head')).toHaveTextContent('The Foreman is reading your message');
    expect(bar().querySelector('.next-sub')).toHaveTextContent(/^Foreman on Opus 5\.5, 12 min on this step\. Nothing for you to do right now\.$/);
    expect(within(bar()).queryByRole('button')).toBeNull();
    cleanup();
    // No model known: " on {model}" is left out.
    setup({ jobs: [job('alpha', 'running', { stage: 'implement', lane: 'working', nowDoing: [{ who: 'feature-implementer', name: 'Builder', doing: 'Building step 1 of 6: the form', since: ago(12) }] })] });
    expect(bar().querySelector('.next-sub')).toHaveTextContent(/^Builder, 12 min on this step\. The Foreman waits for it\./);
  });

  it('a line that is not an -ing phrase follows a colon', () => {
    setup({ jobs: [job('alpha', 'running', { stage: 'implement', lane: 'working', nowDoing: [{ who: 'feature-implementer', name: 'Builder', doing: 'Step 3 of 6', model: 'Sonnet 5.5', since: ago(12) }] })] });
    expect(bar().querySelector('.next-head')).toHaveTextContent(/^The Builder: step 3 of 6$/);
  });

  it('several crew at once are named in one line', () => {
    const crew = [
      { who: 'feature-reviewer', name: 'Spec', doing: 'Reviewing the spec', model: 'Opus 5.5', since: ago(12) },
      { who: 'feature-review-errors', name: 'Errors', doing: 'Reviewing errors', since: ago(9) },
      { who: 'feature-review-tests', name: 'Tests', doing: 'Reviewing the tests', since: ago(8) },
      { who: 'feature-review-ui', name: 'Screens', doing: 'Reviewing the screens', since: ago(3) },
    ];
    setup({ jobs: [job('alpha', 'running', { stage: 'review', lane: 'working', nowDoing: crew })] });
    expect(bar().querySelector('.next-head')).toHaveTextContent('The Spec is reviewing the spec');
    expect(bar().querySelector('.next-sub')).toHaveTextContent(/^4 reviewers on this step: Spec, Errors, Tests and Screens, 12 min\. The Foreman waits for them\. Nothing for you to do right now\.$/);
    cleanup();
    // Different roles: "crew".
    setup({ jobs: [job('alpha', 'running', { stage: 'test', lane: 'working', nowDoing: [{ who: 'feature-tester', name: 'Tester', doing: 'Running the checks', since: ago(5) }, { who: 'feature-implementer', name: 'Builder', doing: 'Fixing a test', since: ago(12) }] })] });
    expect(bar().querySelector('.next-sub')).toHaveTextContent(/^2 crew on this step: Tester and Builder, 12 min\. The Foreman waits for them\. Nothing for you to do right now\.$/);
  });

  it('while evidence records the bar says so and offers Watch on the laptop only', async () => {
    const onWatch = vi.fn();
    const recording = () => [job('alpha', 'running', { stage: 'test', lane: 'working', testing: 'Recording evidence: line 4 of 19', nowDoing: [{ who: 'conductor', name: 'Foreman', doing: 'Recording the evidence', since: ago(2) }] })];
    setup({ jobs: recording(), page: { checks: { passed: 46, failed: 0, notRun: 0, at: NOW } }, onWatch });
    expect(bar().querySelector('.next-head')).toHaveTextContent(/^Recording evidence: line 4 of 19$/);
    await waitFor(() => expect(bar().querySelector('.next-sub')).toHaveTextContent(/^Starbase plays each acceptance line in a hidden browser\. The Tester’s checks passed, 46 of 46\.$/));
    fireEvent.click(within(bar()).getByRole('button', { name: 'Watch' }));
    expect(onWatch).toHaveBeenCalledTimes(1);
    cleanup();
    // A failed check: no line about the Tester's checks.
    setup({ jobs: recording(), page: { checks: { passed: 44, failed: 2, notRun: 0, at: NOW } }, onWatch });
    await act(async () => {});
    expect(bar().querySelector('.next-sub')).toHaveTextContent(/^Starbase plays each acceptance line in a hidden browser\.$/);
    cleanup();
    // The website: the same words, no Watch, and a sentence saying it is on the laptop.
    setup({ jobs: recording(), hosted: true, onWatch });
    expect(bar()).toHaveTextContent('Recording evidence: line 4 of 19');
    expect(within(bar()).queryByRole('button', { name: 'Watch' })).toBeNull();
    expect(bar().querySelector('.next-sub')).toHaveTextContent(/^Starbase plays each acceptance line in a hidden browser\. You can watch it on the laptop\.$/);
    cleanup();
    // A page that offers no Watch.
    setup({ jobs: recording() });
    expect(within(bar()).queryByRole('button', { name: 'Watch' })).toBeNull();
  });

  // Review Focus 1: a job from an older Starbase (no model, no testing, no page, no auto.yours).
  it('an old job with none of the new fields still draws a whole bar', async () => {
    setup({ jobs: [job('alpha', 'running', { stage: 'implement', lane: 'working', nowDoing: [{ who: 'feature-implementer', name: 'Builder', doing: 'Building step 1 of 6: the form' }] })] });
    await act(async () => {});
    expect(bar().querySelector('.next-head')).toHaveTextContent('The Builder is building step 1 of 6: the form');
    expect(bar().querySelector('.next-sub')).toHaveTextContent(/^Builder\. The Foreman waits for it\. Nothing for you to do until the tests\.$/);
    cleanup();
    setup({ jobs: [job('alpha', 'running', { stage: 'plan' })] });
    await act(async () => {});
    expect(bar().querySelector('.next-head')?.textContent).toBeTruthy();
    expect(within(bar()).queryByRole('button')).toBeNull();
  });

  it('a pull request in review: says so, with See the pull requests', () => {
    setup({ jobs: [job('alpha', 'idle', { stage: 'pr1', lane: 'in-review', laneReason: 'PR #1 is open, waiting on a review' })] });
    expect(bar().querySelector('.next-head')).toHaveTextContent(/^PR #1 is open\. Waiting on a review$/);
    expect(bar().querySelector('.next-sub')).toHaveTextContent('Nothing for you to do. We’ll tell you if it gets comments.');
    expect(within(bar()).getByRole('link', { name: 'See the pull requests' })).toHaveAttribute('href', '#/job/alpha');
  });
});

describe('the bar on an Auto job (the owner’s requirement)', () => {
  // Each of the seven steps' gate stages, and the step after it.
  const STEPS: [string, string][] = [['spec', 'investigate'], ['investigate', 'plan'], ['plan', 'implement'], ['implement', 'test'], ['test', 'review'], ['review', 'pr1'], ['pr1', 'pr2']];
  const YOURS = 'Auto stopped: you wrote to this job while this step waited, so it is yours to decide.';
  const AUTO_STATES: [string, Partial<Job>][] = [
    ['on', { lane: 'needs-you', auto: { on: true, by: 'you', ran: true } }],
    ['deciding', { lane: 'working', laneReason: 'Auto is deciding: the plan', auto: { on: true, by: 'you', ran: true } }],
    ['stopped', { lane: 'needs-you', laneReason: 'Auto stopped: the plan adds a database change', auto: { on: true, by: 'you', ran: true, stopped: { reason: 'the plan adds a database change', rule: 'database', at: NOW } } }],
    ['his', { lane: 'needs-you', laneReason: YOURS, auto: { on: true, by: 'you', ran: true, stopped: { reason: 'you wrote to this job while this step waited, so it is yours to decide.' }, yours: true } }],
  ];
  const everyStep = async (hosted: boolean) => {
    for (const [stage, nextStage] of STEPS) {
      for (const [name, extra] of AUTO_STATES) {
        setup({ jobs: waiting({ stage, ...extra }), gate: { ...GATE, stage, nextStage }, hosted });
        await gateShown();
        for (const b of threeCalls()) await waitFor(() => expect(b, `${stage}, Auto ${name}: ${b.textContent}`).toBeEnabled());
        cleanup();
      }
    }
  };

  it('on an Auto job the bar has Send back, Reply and Go, all enabled, at every step that waits', async () => {
    await everyStep(false);
  }, 60_000);

  it('an Auto job that stopped has the stop look and its reason as the bar’s sentence', async () => {
    const reason = 'Auto stopped: the plan adds a database change';
    setup({ jobs: waiting({ laneReason: reason, auto: { on: true, by: 'you', ran: true, stopped: { reason: 'the plan adds a database change', rule: 'database', at: NOW } } }), gate: GATE });
    await gateShown();
    expect(bar()).toHaveClass('tone-stop');
    expect(bar().querySelector('.next-head')).toHaveTextContent(new RegExp(`^${reason}$`));
    expect(bar().querySelector('.next-sub')).toHaveTextContent(/^Answer it yourself and Auto carries on from there\.$/);
    expect(bar()).not.toHaveTextContent('Say go and the Foreman goes ahead');
    for (const b of threeCalls()) await waitFor(() => expect(b).toBeEnabled());
  });

  it('Send back on an Auto job opens What should change? and posts the changes', async () => {
    const post = sentPost({ runEvent: false });
    setup({ jobs: waiting({ lane: 'working', laneReason: 'Auto is deciding: the plan', auto: { on: true, by: 'you', ran: true } }), gate: GATE, post });
    await gateShown();
    const back = within(bar()).getByRole('button', { name: /^No go: send back/ });
    await waitFor(() => expect(back).toBeEnabled());
    fireEvent.click(back);
    fireEvent.change(await screen.findByRole('textbox', { name: /What should change\?/ }), { target: { value: 'Keep the old column.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send back' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/job/alpha/gate', expect.objectContaining({ kind: 'changes', note: 'Keep the old column.' })));
    expect(post.mock.calls.filter(([, b]) => (b as { kind?: string })?.kind === 'approve')).toHaveLength(0);
  });

  it('a step you wrote to on an Auto job has the stop look, the three calls and never says Auto is deciding', async () => {
    const reason = 'Auto stopped: you wrote to this job while this step waited, so it is yours to decide.';
    setup({ jobs: waiting({ lane: 'needs-you', laneReason: reason, auto: { on: true, stopped: { reason: 'you wrote to this job while this step waited, so it is yours to decide.' }, yours: true } }), gate: GATE });
    await gateShown();
    for (const b of threeCalls()) await waitFor(() => expect(b).toBeEnabled());
    expect(bar()).toHaveClass('tone-stop');
    expect(bar().querySelector('.next-head')).toHaveTextContent(new RegExp(`^${reason}$`));
    expect(screen.queryByText(AUTO_DECIDING_NOTE)).toBeNull();
    expect(document.body).not.toHaveTextContent('Auto is deciding');
    cleanup();
    // The lane has not caught up yet (it still says deciding), but the step is his: never "deciding".
    setup({ jobs: waiting({ lane: 'working', laneReason: 'Auto is deciding: the plan', auto: { on: true, yours: true } }), gate: GATE });
    await gateShown();
    for (const b of threeCalls()) await waitFor(() => expect(b).toBeEnabled());
    expect(bar()).toHaveClass('tone-stop');
    expect(bar().querySelector('.next-head')).toHaveTextContent(new RegExp(`^${reason}$`));
    expect(document.body).not.toHaveTextContent('Auto is deciding');
  });

  // Today's rule, kept: a waiting permission card puts its own Allow and Deny in the bar's place.
  it('a waiting permission card takes the bar’s place, and the three calls come back once it is answered', async () => {
    const jobs = waiting({ lane: 'working', laneReason: 'Auto is deciding: the plan', auto: { on: true, by: 'you', ran: true } });
    const { store } = setup({ jobs, permissions: [{ ...permission('p1', 'alpha'), createdAt: NOW }], gate: GATE });
    expect(screen.queryByRole('region', { name: 'Next step' })).toBeNull();
    const alert = screen.getByRole('region', { name: 'Permission: Run a command' });
    expect(within(alert).getByRole('button', { name: /^Allow once/ })).toBeInTheDocument();
    expect(within(alert).getByRole('button', { name: /^Deny/ })).toBeInTheDocument();
    act(() => { store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs, permissions: [], meta: { token: 't', settings: { play: { mode: 'subtle' } } } as never }) }); });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Permission: Run a command' })).toBeNull());
    for (const b of threeCalls()) await waitFor(() => expect(b).toBeEnabled());
  });

  it('on the website a waiting Auto job has Send back, Reply and Go on the bar, and a queued decision replaces them', async () => {
    await everyStep(true);
    const { store } = setup({ jobs: waiting({ lane: 'working', laneReason: 'Auto is deciding: the plan', auto: { on: true, by: 'you', ran: true } }), gate: GATE, hosted: true });
    await gateShown();
    for (const b of threeCalls()) await waitFor(() => expect(b).toBeEnabled());
    server.queued = { id: 'q1', kind: 'approve', state: 'waiting', words: 'Go: waiting for your laptop. It runs when the laptop is back.', at: NOW, expiresAt: null, waiting: true, canCancel: true, permissionId: null };
    act(() => { store.dispatch({ type: 'event', event: ev(30, 'thread', 'alpha', {}) }); });
    expect(await screen.findByText('Go: waiting for your laptop. It runs when the laptop is back.')).toBeInTheDocument();
    expect(within(bar()).queryByRole('button', { name: /^No go: send back/ })).toBeNull();
    expect(within(bar()).queryByRole('button', { name: 'Reply' })).toBeNull();
    expect(within(bar()).queryByRole('button', { name: /^Go: / })).toBeNull();
  }, 60_000);
});

describe('what the bar says after a send', () => {
  /** Answer both questions (No, No), then Go. */
  async function goWithTwoAnswers() {
    const nos = await screen.findAllByRole('radio', { name: /No/ });
    expect(nos).toHaveLength(2);
    for (const r of nos) fireEvent.click(r);
    const go = within(bar()).getByRole('button', { name: /^Go: / });
    await waitFor(() => expect(go).toBeEnabled());
    fireEvent.click(go);
  }

  it('after Go the second line names the answers and the next step', async () => {
    const post = sentPost({ runEvent: false });
    setup({ jobs: waiting(), gate: TWO_QUESTIONS, post });
    await goWithTwoAnswers();
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/job/alpha/gate', expect.objectContaining({ kind: 'approve' })));
    await within(bar()).findByText(SENT_WORDS);
    expect(bar().querySelector('.next-sub')).toHaveTextContent(/^Your go and your two answers reached the Foreman\. Build step 1 starts next\.$/);
    expect(live()).toHaveTextContent(`${SENT_WORDS} Your go and your two answers reached the Foreman. Build step 1 starts next.`);
  });

  it('after Go on an Auto job the second line says Auto carries on', async () => {
    setup({ jobs: waiting({ auto: { on: true, by: 'you', ran: true } }), gate: { ...GATE, stage: 'test', nextStage: 'review', nextProposed: 'Review' }, post: sentPost({ runEvent: false }) });
    await gateShown();
    const go = within(bar()).getByRole('button', { name: /^Go: / });
    await waitFor(() => expect(go).toBeEnabled());
    fireEvent.click(go);
    await within(bar()).findByText(SENT_WORDS);
    expect(bar().querySelector('.next-sub')).toHaveTextContent(/^Your go reached the Foreman\. Review starts next\. Auto carries on from Review\.$/);
  });

  it('after the Foreman’s run starts the second line still names the answers and the next step', async () => {
    const { store } = setup({ jobs: waiting(), gate: TWO_QUESTIONS, post: sentPost() });
    await goWithTwoAnswers();
    await within(bar()).findByText(SENT_WORDS);
    expect(store.getState().runs.alpha).toEqual(expect.objectContaining({ status: 'running' }));
    await act(async () => {});
    expect(within(bar()).getByText(SENT_WORDS)).toBeInTheDocument();
    expect(bar().querySelector('.next-sub')).toHaveTextContent(/^Your go and your two answers reached the Foreman\. Build step 1 starts next\.$/);
  });

  it('after Reply the card stays open', async () => {
    setup({ jobs: waiting(), gate: GATE, post: sentPost() });
    await gateShown();
    const reply = within(bar()).getByRole('button', { name: 'Reply' });
    await waitFor(() => expect(reply).toBeEnabled());
    fireEvent.click(reply);
    fireEvent.change(await screen.findByRole('textbox', { name: /Your answers or a note/ }), { target: { value: 'What does the old column feed?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send the reply' }));
    await within(bar()).findByText(SENT_WORDS);
    expect(bar().querySelector('.next-sub')).toHaveTextContent(/^Your reply reached the Foreman\. Nothing is approved, so the card stays open\.$/);
    expect(document.querySelector('.job-gate-body [data-gate="approve"]')).not.toBeNull();
  });

  it('after Send back the Foreman stays at the step', async () => {
    setup({ jobs: waiting({ stage: 'test' }), gate: { ...GATE, stage: 'test', nextStage: 'review', nextProposed: 'Review' }, post: sentPost() });
    await gateShown();
    const back = within(bar()).getByRole('button', { name: /^No go: send back/ });
    await waitFor(() => expect(back).toBeEnabled());
    fireEvent.click(back);
    fireEvent.change(await screen.findByRole('textbox', { name: /What should change\?/ }), { target: { value: 'Record line 4 again.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send back' }));
    await within(bar()).findByText(SENT_WORDS);
    expect(bar().querySelector('.next-sub')).toHaveTextContent(/^Sent back: the Foreman stays at Test and revises\. Nothing is approved\.$/);
  });

  it('after a reload the second line has no count and no next step', async () => {
    // Nothing on this page was sent: the brief is answered, his Go is in the thread, a run works.
    const yourGo: ThreadItem = { id: 'you-1', kind: 'you', at: NOW, text: 'Approved, with two answers.', sendKind: 'approve', gateBrief: 2 } as ThreadItem;
    const { store } = setup({ jobs: waiting(), gate: TWO_QUESTIONS, answered: [2], thread: [yourGo] });
    act(() => { store.dispatch({ type: 'event', event: ev(20, 'run', 'alpha', { id: 'r_x', slug: 'alpha', status: 'running' }) }); });
    await waitFor(() => expect(bar()).toHaveTextContent(SENT_WORDS));
    expect(bar().querySelector('.next-sub')).toHaveTextContent(/^Your go reached the Foreman\.$/);
    expect(bar()).not.toHaveTextContent('answers');
    expect(bar()).not.toHaveTextContent('starts next');
  });

  it('useSentShown is the kind sent while the bar shows Sent, and null once the bar shows the next step', async () => {
    const { store } = setup({ jobs: waiting(), gate: GATE, post: sentPost() });
    await gateShown();
    const go = within(bar()).getByRole('button', { name: /^Go: / });
    await waitFor(() => expect(go).toBeEnabled());
    expect(shownKind()).toBe('none');
    fireEvent.click(go);
    await within(bar()).findByText(SENT_WORDS);
    expect(shownKind()).toBe('approve');
    // The run started: the send's own state has cleared, and the bar still says Sent.
    await act(async () => {});
    expect(within(bar()).getByText(SENT_WORDS)).toBeInTheDocument();
    expect(shownKind()).toBe('approve');
    // The job moves on to Build: the bar shows the next step.
    server.gate = null;
    act(() => { store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: waiting({ stage: 'implement', waitingFor: null, lane: 'working' }), meta: { token: 't', settings: { play: { mode: 'subtle' } } } as never }) }); });
    act(() => { store.dispatch({ type: 'event', event: ev(300, 'thread', 'alpha', {}) }); });
    await waitFor(() => expect(bar()).not.toHaveTextContent(SENT_WORDS));
    expect(shownKind()).toBe('none');
  });

  it('sentLine', () => {
    const go = (answers: number | null, next: string | null, auto = false) => sentLine('approve', { answers, next, step: 'Test', auto });
    expect(go(1, 'Review')).toBe('Your go and your one answer reached the Foreman. Review starts next.');
    expect(go(2, 'Review')).toBe('Your go and your two answers reached the Foreman. Review starts next.');
    expect(go(9, 'Review')).toBe('Your go and your nine answers reached the Foreman. Review starts next.');
    expect(go(10, 'Review')).toBe('Your go and your 10 answers reached the Foreman. Review starts next.');
    expect(go(0, 'Review')).toBe('Your go reached the Foreman. Review starts next.');
    expect(go(2, null)).toBe('Your go and your two answers reached the Foreman.');
    expect(go(null, null)).toBe('Your go reached the Foreman.');
    expect(go(2, 'Review', true)).toBe('Your go and your two answers reached the Foreman. Review starts next. Auto carries on from Review.');
    expect(sentLine('message', { answers: 2, next: 'Review', step: 'Test', auto: true })).toBe('Your reply reached the Foreman. Nothing is approved, so the card stays open.');
    expect(sentLine('changes', { answers: 0, next: 'Review', step: 'Test', auto: true })).toBe('Sent back: the Foreman stays at Test and revises. Nothing is approved.');
    expect(sentLine('changes', { answers: null, next: null, step: null, auto: false })).toBe('Sent back: the Foreman stays at this step and revises. Nothing is approved.');
  });
});

// Task 8 (design 3.3): the Reply and Send back boxes open at the top of the card, directly under the bar.
describe('the boxes under the bar', () => {
  /** The card under the bar, and its first part. */
  const gateCard = () => document.querySelector('.job-gate-body .gate-card')!;

  it('Send back’s box opens at the top of the card, asks What should change? and its button says Send back', async () => {
    const post = sentPost({ runEvent: false });
    setup({ jobs: waiting(), gate: TWO_QUESTIONS, post });
    await gateShown();
    const back = within(bar()).getByRole('button', { name: /^No go: send back/ });
    await waitFor(() => expect(back).toBeEnabled());
    fireEvent.click(back);
    const box = await screen.findByRole('textbox', { name: 'What should change? The Foreman stays at this step and revises; nothing is approved.' });
    expect(box).toHaveAttribute('placeholder', 'Say what should change…');
    expect(box).toHaveFocus();
    // Above the card's head and its questions.
    expect(gateCard().firstElementChild).toHaveClass('gate-note');
    expect(gateCard().firstElementChild).toContainElement(box);
    expect([...gateCard().querySelectorAll('.gate-note button')].map((b) => b.textContent)).toEqual(['Cancel', 'Send back']);
    fireEvent.change(box, { target: { value: 'Keep the old column.' } });
    fireEvent.click(within(gateCard() as HTMLElement).getByRole('button', { name: 'Send back' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/job/alpha/gate', expect.objectContaining({ kind: 'changes', note: 'Keep the old column.' })));
    expect(post.mock.calls.filter(([, b]) => (b as { kind?: string })?.kind === 'approve')).toHaveLength(0);
  });

  it('Reply’s box says nothing is approved', async () => {
    setup({ jobs: waiting(), gate: GATE, post: sentPost(), hosted: true });
    await gateShown();
    const reply = within(bar()).getByRole('button', { name: 'Reply' });
    await waitFor(() => expect(reply).toBeEnabled());
    fireEvent.click(reply);
    const box = await screen.findByRole('textbox', { name: 'Your answers or a note for the Foreman. Nothing is approved.' });
    expect(box).toHaveAttribute('placeholder', 'Write your answers or a note…');
    expect(gateCard().firstElementChild).toContainElement(box);
    expect([...gateCard().querySelectorAll('.gate-note button')].map((b) => b.textContent)).toEqual(['Cancel', 'Send the reply']);
    // Cancel closes it; nothing went.
    fireEvent.click(within(gateCard() as HTMLElement).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('textbox', { name: /Your answers or a note/ })).toBeNull();
  });
});
