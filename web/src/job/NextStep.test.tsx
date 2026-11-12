// The bar at the top of a job (design 3.3; the owner's requirement): who is working and on what,
// evidence being recorded, what Auto is doing, and what was just sent. On every step that waits for
// him, on Auto jobs too, the bar has Send back, Reply and Go, all of them pressable; the two states
// that keep today's rule (a permission card takes the bar's place; a status card has Reply only)
// say so where they are tested. Invented jobs and requests only; no model calls.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../api/client';
import type { Gate, Job, JobDetail, Permission, ThreadItem } from '../api/types';
import { setDefaultDetail } from '../app/detail';
import { installKeyListener } from '../app/keyRegistry';
import { UiProvider } from '../app/ui';
import { useJobConversation } from '../panes/Foreman/ForemanPane';
import { jobBySlug } from '../state/reducer';
import { createStore, useWorkshopState, WorkshopContext, type Store } from '../state/store';
import { ev, job, permission, snapshot } from '../state/test-fixtures';
import type { QueuedView } from '../views/Hosted/QueuedDecision';
import { clearAllSent } from '../lib/sentState';
import { clearGateSent } from '../panes/Foreman/gateSent';
import { AUTO_DECIDING_NOTE } from './autoLine';
import { forHowLong, NextStep, useSentShown } from './NextStep';
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
  /** The job's details never come ('loading') or the fetch fails ('fails'). */
  details: 'ok' as 'ok' | 'loading' | 'fails',
};

/** The bar as a page draws it, and what useSentShown says beside it. */
function Bar({ job: j, onWatch, foldCard }: { job: Job; onWatch?: () => void; foldCard?: boolean }) {
  const conversation = useJobConversation(j);
  const shown = useSentShown(j, conversation);
  return (
    <>
      <NextStep job={j} conversation={conversation} now={new Date()} onWatch={onWatch} foldCard={foldCard} />
      <output data-sent-shown>{shown === null ? 'none' : shown.kind ?? 'unknown'}</output>
    </>
  );
}
function Host({ slug, onWatch, foldCard }: { slug: string; onWatch?: () => void; foldCard?: boolean }) {
  const j = jobBySlug(useWorkshopState(), slug);
  return j ? <Bar job={j} onWatch={onWatch} foldCard={foldCard} /> : null;
}

function setup({ jobs = [job('alpha', 'idle', { stage: 'plan' })], permissions = [] as Permission[], gate = null as Gate | null, answered = [] as number[], thread = [] as ThreadItem[], page = undefined as JobDetail['page'], hosted = false, onWatch = undefined as (() => void) | undefined, foldCard = false, details = 'ok' as typeof server.details, post = vi.fn(async (_path: string, _body?: unknown): Promise<unknown> => ({ ok: true })) } = {}) {
  const store: Store = createStore();
  server.store = store;
  server.answered = [...answered];
  server.gate = undefined;
  server.thread = thread;
  server.page = page;
  server.queued = null;
  server.details = details;
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs, permissions, meta: { token: 't', settings: { play: { mode: 'subtle' } } } as never }) });
  const detail = (s: string): JobDetail => ({ slug: s, thread: server.thread, threadMore: false, gate: server.gate === undefined ? gate : server.gate, answeredBriefs: [...server.answered], heldReply: null, options: { level: 1 }, page: server.page, queued: server.queued } as JobDetail);
  const get = vi.fn(async (path: string): Promise<unknown> => {
    if (path.endsWith('/evidence')) return { runs: [] };
    if (path.startsWith('/api/review/')) return null;
    if (server.details === 'loading') return new Promise(() => {});
    if (server.details === 'fails') throw new Error('Starbase did not answer.');
    return detail(path.split('/')[3]);
  });
  const api = { get, post, ...(hosted ? { hosted: () => true } : {}) } as unknown as ApiClient;
  const utils = render(<WorkshopContext.Provider value={{ store, api }}><UiProvider><Host slug="alpha" onWatch={onWatch} foldCard={foldCard} /></UiProvider></WorkshopContext.Provider>);
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
    expect(bar().querySelector('.next-sub')).toHaveTextContent(/^Your go and your two answers reached the Foreman\. Build starts next\.$/);
    expect(live()).toHaveTextContent(`${SENT_WORDS} Your go and your two answers reached the Foreman. Build starts next.`);
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
    expect(bar().querySelector('.next-sub')).toHaveTextContent(/^Your go and your two answers reached the Foreman\. Build starts next\.$/);
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

// Task 7 fix round 1.
describe('the bar: Auto’s go, the Foreman among the crew, and the small words', () => {
  const autoGo: ThreadItem = { id: 'you-auto', kind: 'you', at: NOW, text: 'Approved.', sendKind: 'approve', gateBrief: 2, by: 'auto' } as ThreadItem;
  const hisGo: ThreadItem = { id: 'you-his', kind: 'you', at: NOW, text: 'Approved.', sendKind: 'approve', gateBrief: 2 } as ThreadItem;
  const auto = { on: true, by: 'you' as const, ran: true };

  it('a brief Auto approved is not said to be your go; one you approved still is after a reload', async () => {
    const { store } = setup({ jobs: waiting({ auto }), gate: GATE, answered: [2], thread: [autoGo] });
    act(() => { store.dispatch({ type: 'event', event: ev(20, 'run', 'alpha', { id: 'r_auto', slug: 'alpha', status: 'running' }) }); });
    await waitFor(() => expect(bar()).toHaveTextContent('Sent by Auto. Waiting for the Foreman to start.'));
    expect(bar()).not.toHaveTextContent('Your go');
    expect(shownKind()).toBe('none');
    cleanup();
    const again = setup({ jobs: waiting({ auto }), gate: GATE, answered: [2], thread: [autoGo, hisGo] });
    act(() => { again.store.dispatch({ type: 'event', event: ev(20, 'run', 'alpha', { id: 'r_his', slug: 'alpha', status: 'running' }) }); });
    await waitFor(() => expect(bar().querySelector('.next-sub')).toHaveTextContent(/^Your go reached the Foreman\. Auto carries on from the next step\.$/));
    expect(shownKind()).toBe('approve');
  });

  it('the Foreman listed with crew is left out: one crew member, then several', () => {
    const foreman = { who: 'conductor', name: 'Foreman', doing: 'Waiting for the Builder', model: 'Opus 5.5', since: ago(20) };
    const builder = { who: 'feature-implementer', name: 'Builder', doing: 'Building step 3 of 6: the Pause dialog', model: 'Sonnet 5.5', since: ago(12) };
    setup({ jobs: [job('alpha', 'running', { stage: 'implement', lane: 'working', nowDoing: [foreman, builder] })] });
    expect(bar().querySelector('.next-head')).toHaveTextContent(/^The Builder is building step 3 of 6: the Pause dialog$/);
    expect(bar().querySelector('.next-sub')).toHaveTextContent(/^Builder on Sonnet 5\.5, 12 min on this step\. The Foreman waits for it\. Nothing for you to do until the tests\.$/);
    cleanup();
    setup({ jobs: [job('alpha', 'running', { stage: 'implement', lane: 'working', nowDoing: [foreman, builder, { who: 'feature-tester', name: 'Tester', doing: 'Running the checks', since: ago(5) }] })] });
    expect(bar().querySelector('.next-sub')).toHaveTextContent(/^2 crew on this step: Builder and Tester, 12 min\. The Foreman waits for them\. Nothing for you to do until the tests\.$/);
  });

  it('useSentShown keeps the kind while Try again is out', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      // The gate never answers: the Go is stuck after 30 seconds, and Try again stays out.
      const post = vi.fn((path: string, _body?: unknown): Promise<unknown> => (path.endsWith('/gate') ? new Promise(() => {}) : Promise.resolve({ ok: true })));
      setup({ jobs: waiting(), gate: GATE, post });
      await gateShown();
      const go = within(bar()).getByRole('button', { name: /^Go: / });
      await waitFor(() => expect(go).toBeEnabled());
      fireEvent.click(go);
      act(() => { vi.advanceTimersByTime(30_000); });
      await within(bar()).findByText('Nothing has moved yet.');
      expect(shownKind()).toBe('approve');
      fireEvent.click(within(bar()).getByRole('button', { name: 'Try again' }));
      await waitFor(() => expect(post.mock.calls.filter(([p]) => p === '/api/job/alpha/gate')).toHaveLength(2));
      expect(within(bar()).getByText('Nothing has moved yet.')).toBeInTheDocument();
      expect(shownKind()).toBe('approve');
    } finally {
      vi.useRealTimers();
    }
  });

  it('the next step is said by its step’s own name, and left out when it names no step', async () => {
    const goOn = async (gate: Gate) => {
      setup({ jobs: waiting(), gate, post: sentPost({ runEvent: false }) });
      await gateShown();
      const go = within(bar()).getByRole('button', { name: /^Go: / });
      await waitFor(() => expect(go).toBeEnabled());
      fireEvent.click(go);
      await within(bar()).findByText(SENT_WORDS);
      const line = bar().querySelector('.next-sub')?.textContent;
      // As between tests: the page that sent it is gone, and so is what it sent.
      cleanup();
      clearAllSent();
      clearGateSent();
      return line;
    };
    // The gate's next stage is a step: its name, never the Foreman's own words.
    expect(await goOn({ ...GATE, nextStage: 'implement', nextProposed: 'Run the tests' })).toBe('Your go reached the Foreman. Build starts next.');
    // No next stage: the Foreman's words count only when they are a step's name.
    expect(await goOn({ ...GATE, nextStage: null, nextProposed: 'Review' } as unknown as Gate)).toBe('Your go reached the Foreman. Review starts next.');
    expect(await goOn({ ...GATE, nextStage: null, nextProposed: 'Run the tests' } as unknown as Gate)).toBe('Your go reached the Foreman.');
  });

  it('while the job’s details load or fail, a job that waits for you never gets the crew bar', async () => {
    const crew = [{ who: 'feature-implementer', name: 'Builder', doing: 'Building step 3 of 6: the Pause dialog', model: 'Sonnet 5.5', since: ago(12) }];
    for (const details of ['loading', 'fails'] as const) {
      for (const card of [{ lane: 'needs-you' as const }, { lane: 'working' as const, needsYou: true, laneReason: 'Auto is deciding: the plan', auto }]) {
        setup({ jobs: waiting({ stage: 'implement', nowDoing: crew, ...card }), gate: GATE, details });
        await act(async () => {});
        expect(bar(), `${details} ${card.lane}`).toHaveTextContent('The Foreman asked you something');
        expect(bar()).not.toHaveTextContent('The Builder');
        expect(bar()).not.toHaveTextContent('Nothing for you to do');
        cleanup();
      }
    }
  });

  it('a step is yours only while Auto is on', async () => {
    setup({ jobs: waiting({ auto: { on: false, yours: true } }), gate: GATE });
    await gateShown();
    expect(bar()).not.toHaveClass('tone-stop');
    expect(bar()).not.toHaveTextContent('Auto stopped');
    expect(bar()).toHaveTextContent('Say go and the Foreman goes ahead: Build step 1');
  });

  it('a word that ends in -ing but is not a verb takes the colon', () => {
    for (const [doing, say] of [['Nothing to report yet', 'The Builder: nothing to report yet'], ['Something broke in step 2', 'The Builder: something broke in step 2'], ['String tests for the form', 'The Builder: string tests for the form'], ['During step 2, a retry', 'The Builder: during step 2, a retry'], ['Testing the form', 'The Builder is testing the form']]) {
      setup({ jobs: [job('alpha', 'running', { stage: 'implement', lane: 'working', nowDoing: [{ who: 'feature-implementer', name: 'Builder', doing, since: ago(12) }] })] });
      expect(bar().querySelector('.next-head')).toHaveTextContent(new RegExp(`^${say}$`));
      cleanup();
    }
  });
});

// Task 8, fix round 1 (M2): Cancel gives focus back to the bar's call that opened the box.
describe('Cancel under the bar', () => {
  it('Cancel gives focus back to No go: send back or Reply', async () => {
    setup({ jobs: waiting(), gate: GATE, post: sentPost() });
    await gateShown();
    for (const [name, box] of [[/^No go: send back/, /What should change\?/], ['Reply', /Your answers or a note/]] as const) {
      const call = within(bar()).getByRole('button', { name });
      await waitFor(() => expect(call).toBeEnabled());
      call.focus();
      fireEvent.click(call);
      expect(await screen.findByRole('textbox', { name: box })).toHaveFocus();
      fireEvent.click(within(document.querySelector<HTMLElement>('.job-gate-body .gate-note')!).getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('textbox', { name: box })).toBeNull();
      expect(call).toHaveFocus();
    }
    // The three calls stay on.
    for (const b of threeCalls()) await waitFor(() => expect(b).toBeEnabled());
  });
});

// Task 7 follow-up: the sent line never names the step you are at; a permission is not a question; Auto's send says so.
describe('the sent line names the step that comes next, never the one you are at', () => {
  const autoOn = { on: true, by: 'you' as const, ran: true };
  async function goAt(gate: Gate, extra: Partial<Job> = {}) {
    setup({ jobs: waiting({ stage: gate.stage ?? 'plan', ...extra }), gate, post: sentPost({ runEvent: false }) });
    await gateShown();
    const go = within(bar()).getByRole('button', { name: /^Go: / });
    await waitFor(() => expect(go).toBeEnabled());
    fireEvent.click(go);
    await within(bar()).findByText(SENT_WORDS);
    const line = bar().querySelector('.next-sub')?.textContent;
    cleanup();
    clearAllSent();
    clearGateSent();
    return line;
  }

  it('a next stage in the step you are at names no step; one in the next step still does', async () => {
    const atSpec = await goAt({ ...GATE, stage: 'spec', nextStage: 'refine', nextProposed: 'Refine the spec' }, { auto: autoOn });
    expect(atSpec).toBe('Your go reached the Foreman. Auto carries on from the next step.');
    expect(atSpec).not.toMatch(/Spec starts next|Auto carries on from Spec/);
    expect(await goAt({ ...GATE, stage: 'spec', nextStage: 'wireframe', nextProposed: 'Draw the screens' })).toBe('Your go reached the Foreman.');
    expect(await goAt({ ...GATE, stage: 'pr1', nextStage: 'pr2', nextProposed: 'PR #2' })).toBe('Your go reached the Foreman.');
    // The Foreman's own words name the step you are at: no step either.
    expect(await goAt({ ...GATE, stage: 'investigate', nextStage: null, nextProposed: 'Investigate' } as unknown as Gate)).toBe('Your go reached the Foreman.');
    expect(await goAt({ ...GATE, stage: 'spec', nextStage: 'plan', nextProposed: 'Plan the work' })).toBe('Your go reached the Foreman. Plan starts next.');
    expect(await goAt({ ...GATE, stage: 'spec', nextStage: 'plan', nextProposed: 'Plan the work' }, { auto: autoOn })).toBe('Your go reached the Foreman. Plan starts next. Auto carries on from Plan.');
  });

  it('a permission that waits is not a question: the crew’s bar shows while the details load or fail', async () => {
    const crew = [{ who: 'feature-implementer', name: 'Builder', doing: 'Building step 3 of 6: the Pause dialog', model: 'Sonnet 5.5', since: ago(12) }];
    for (const details of ['loading', 'fails'] as const) {
      setup({ jobs: [job('alpha', 'running', { stage: 'implement', lane: 'working', needsYou: true, waitingFor: 'permission', nowDoing: crew })], details });
      await act(async () => {});
      expect(bar(), details).not.toHaveTextContent('The Foreman asked you something');
      expect(bar()).toHaveTextContent('The Builder is building step 3 of 6: the Pause dialog');
      cleanup();
    }
  });

  it('a brief Auto approved says Sent by Auto, and is never his', async () => {
    const autoGo = { id: 'you-auto', kind: 'you', at: NOW, text: 'Approved.', sendKind: 'approve', gateBrief: 2, by: 'auto' } as ThreadItem;
    const { store } = setup({ jobs: waiting({ auto: autoOn }), gate: GATE, answered: [2], thread: [autoGo] });
    act(() => { store.dispatch({ type: 'event', event: ev(20, 'run', 'alpha', { id: 'r_auto', slug: 'alpha', status: 'running' }) }); });
    await waitFor(() => expect(bar().querySelector('.next-head')).toHaveTextContent(/^Sent by Auto\. Waiting for the Foreman to start\.$/));
    expect(live()).toHaveTextContent('Sent by Auto. Waiting for the Foreman to start.');
    expect(shownKind()).toBe('none');
  });
});

// Review of Task 15a, fix 3: today's Job page and step page draw the bar with NextStep too, so the gate
// card that stays mounted, hidden, under a permission card is tested here as well as on the new page.
describe('the gate card under a permission card', () => {
  const ask = (): Permission => ({ ...permission('p1', 'alpha'), createdAt: NOW, input: { command: 'npm test' } });
  const perms = (store: Store, list: Permission[]) => act(() => {
    store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: waiting(), permissions: list, meta: { token: 't', settings: { play: { mode: 'subtle' } } } as never }) });
  });

  it('a permission card hides the gate card without unmounting it: the typed words are there when it goes', async () => {
    const { store } = setup({ jobs: waiting(), gate: GATE });
    await gateShown();
    fireEvent.click(screen.getByRole('button', { name: /^No go: send back/ }));
    const box = await screen.findByRole('textbox', { name: /What should change\?/ });
    fireEvent.change(box, { target: { value: 'Use the small table.' } });
    perms(store, [ask()]);
    expect(screen.getByRole('region', { name: 'Permission: Run a command' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Next step' })).toBeNull();
    // Hidden, not gone.
    expect(box.isConnected).toBe(true);
    expect(box.closest('[hidden]')).not.toBeNull();
    perms(store, []);
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Permission: Run a command' })).toBeNull());
    expect(screen.getByRole('textbox', { name: /What should change\?/ })).toBe(box);
    expect(box).toHaveValue('Use the small table.');
    expect(box.closest('[hidden]')).toBeNull();
  });

  it('the hidden gate card’s keys are off', async () => {
    const post = vi.fn(async (_path: string, _body?: unknown): Promise<unknown> => ({ ok: true }));
    const { store } = setup({ jobs: waiting(), gate: GATE, post });
    await gateShown();
    perms(store, [{ ...ask(), hardLine: { line: 'push', reason: 'It pushes to GitHub.' } } as Permission]);
    // r would open the card's send back box; a would approve (a hard line answers no key either).
    fireEvent.keyDown(document.body, { key: 'r' });
    fireEvent.keyDown(document.body, { key: 'a' });
    await act(async () => {});
    expect(post).not.toHaveBeenCalled();
    perms(store, []);
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Permission: Run a command' })).toBeNull());
    expect(screen.queryByRole('textbox', { name: /What should change\?/ })).toBeNull();
    for (const b of threeCalls()) await waitFor(() => expect(b).toBeEnabled());
  });
});

// Moved from the old step page's tests: with foldCard (the phone's screens use it) the
// brief under the bar folds to one row in Simple and starts open in Full; the bar's calls and the
// card's keys still open its boxes.
describe('the brief folded under the bar (foldCard)', () => {
  const row = () => screen.getByRole('button', { name: /^The brief/ });
  const body = () => document.querySelector('.job-gate-body')!;

  it('Simple: the brief under the go / no go bar folds to one labelled row; opening it shows the brief', async () => {
    setDefaultDetail('simple');
    setup({ jobs: waiting(), gate: GATE, foldCard: true });
    await gateShown();
    expect(row()).toHaveAttribute('aria-expanded', 'false');
    expect(row()).toHaveTextContent('its questions and details, also on the job’s page');
    expect(body()).not.toBeVisible();
    fireEvent.click(row());
    expect(row()).toHaveAttribute('aria-expanded', 'true');
    expect(body()).toBeVisible();
    expect(body()).toHaveTextContent('Plan v2 ready');
  });

  it('the bar has Send back, Reply and Go; Reply opens its box even with the brief folded', async () => {
    setDefaultDetail('simple');
    setup({ jobs: waiting(), gate: GATE, foldCard: true });
    await gateShown();
    await waitFor(() => expect(within(bar()).getByRole('button', { name: 'Reply' })).toBeEnabled());
    expect(within(bar()).getAllByRole('button').map((b) => b.textContent?.replace(/\s+/g, ' ').trim())).toEqual([expect.stringMatching(/^No go: send back/), 'Reply', expect.stringMatching(/^Go:/)]);
    expect(body()).not.toBeVisible();
    fireEvent.click(within(bar()).getByRole('button', { name: 'Reply' }));
    expect(await screen.findByRole('textbox', { name: /Your answers or a note/ })).toBeVisible();
  });

  it('the o key opens a folded brief too', async () => {
    setDefaultDetail('simple');
    setup({ jobs: waiting(), gate: GATE, foldCard: true });
    await gateShown();
    await waitFor(() => expect(within(bar()).getByRole('button', { name: 'Reply' })).toBeEnabled());
    expect(body()).not.toBeVisible();
    fireEvent.keyDown(document.body, { key: 'o' });
    expect(await screen.findByRole('textbox', { name: /Your answers or a note/ })).toBeVisible();
  });

  it('Full: the brief starts open, and its row folds it', async () => {
    setup({ jobs: waiting(), gate: GATE, foldCard: true });
    await gateShown();
    expect(row()).toHaveAttribute('aria-expanded', 'true');
    expect(body()).toBeVisible();
    fireEvent.click(row());
    expect(row()).toHaveAttribute('aria-expanded', 'false');
    expect(body()).not.toBeVisible();
  });
});

// Moved from the old step page's tests: the bar's own "how long" words (its copy was the step page's).
describe('forHowLong', () => {
  it('forHowLong says how long in words', () => {
    const now = new Date('2026-10-21T12:00:00Z');
    expect(forHowLong('2026-10-21T11:42:00Z', now)).toBe('18 min');
    expect(forHowLong('2026-10-21T09:00:00Z', now)).toBe('3 h');
    expect(forHowLong('2026-10-18T09:00:00Z', now)).toBe('3 days');
    expect(forHowLong('2026-10-21T11:59:30Z', now)).toBe('under a minute');
    expect(forHowLong(null, now)).toBeNull();
  });
});
