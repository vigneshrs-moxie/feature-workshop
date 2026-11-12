import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installKeyListener } from '../../app/keyRegistry';
import { UiProvider } from '../../app/ui';
import { ApiError, type ApiClient } from '../../api/client';
import { ON_LAPTOP_LINE } from '../Preview/ScreensTab';
import { clearWireframes, mountFrame, receive } from '../Preview/wireframes';
import type { Gate, GateResult, Job, JobDetail, Run } from '../../api/types';
import { gateDraftKey } from '../../lib/gateCard';
import { writeStored } from '../../lib/stored';
import { createStore, WorkshopContext, type Store } from '../../state/store';
import { job, LEVELS, REVIEWERS, snapshot } from '../../state/test-fixtures';
import { Composer, draftKey } from './Composer';
import { CHANGES_TYPED, gateBoxKey, GateSlot, useKeptBoxWords } from './GateCard';
import { clearGateSent, gateSentKey } from './gateSent';
import { clearAllSent, useSent } from '../../lib/sentState';

// An invented job and gate; no real job names.
const QUESTIONS: Gate['questions'] = [
  { id: '1', text: 'Keep the old column?', recommendation: 'a', options: [{ id: 'a', label: 'Yes' }, { id: 'b', label: 'No' }] },
  { id: '2', text: 'What should the button say?', recommendation: null, options: [] },
];
const DECIDED: Gate['decided'] = [
  { id: 'D-1', decision: 'Reviewers: head inspector', reason: 'L1 default', where: 'review', confirmed: false },
  { id: 'D-2', decision: 'Toast text is “Copied”', reason: null, where: null, confirmed: false },
  { id: 'D-0', decision: 'Already settled', reason: null, where: null, confirmed: true },
];
const VERSIONS = { spec: null, artifacts: { 'Quick plan': '2' } };
const GATE: Gate = {
  briefNumber: 2, briefFile: 'briefs/002-plan.md', headline: 'Plan v2 ready', stage: 'plan', nextStage: 'implement', nextProposed: 'Build step 1',
  questions: QUESTIONS, decided: DECIDED, versions: VERSIONS, raisedVersions: VERSIONS, stale: false,
  waitingSince: new Date(Date.now() - 2 * 3600_000).toISOString(), runActive: false, parked: false,
  level: 1, suggestedLevel: null, levelReason: null, usage: null,
};
const STATUS = { questions: QUESTIONS, decidedOnYourBehalf: DECIDED.map(({ id, decision, confirmed }) => ({ id: id ?? undefined, decision, confirmed })), nextProposed: 'Build step 1', spec: null, artifacts: [{ name: 'Quick plan', version: '2' }], brief: { number: 2 } };
const OPTIONS = { level: 1 as const, fable_checks: [] as string[] };
const detail = (gate: Partial<Gate> | null = {}, extra: Partial<JobDetail> = {}): JobDetail => ({
  slug: 'alpha', thread: [], threadMore: false, options: OPTIONS, statusForCompose: STATUS, drive: { mode: 'workshop', model: 'claude-opus-5-5' },
  gate: gate === null ? null : { ...GATE, ...gate }, answeredBriefs: [], heldReply: null, ...extra,
});
// The same gate with only its first question (its recommendation picked), for tests about other things than answering.
const oneQ = (gate: Partial<Gate> = {}, extra: Partial<JobDetail> = {}) => detail({ questions: [QUESTIONS[0]], ...gate }, extra);
const SENT: GateResult = { ok: true, sent: true, text: 'sent text' };
const MODELS = [{ id: 'claude-opus-5-5', label: 'Opus 5.5' }];

function setup({ det = detail(), post = vi.fn(async (): Promise<unknown> => SENT), get = vi.fn(), jobExtra = {}, composer = false, limited = false, run = null, hosted = false }: {
  det?: JobDetail; post?: ReturnType<typeof vi.fn>; get?: ReturnType<typeof vi.fn>; jobExtra?: Partial<Job>; composer?: boolean; limited?: boolean; run?: Run | null; /** The website's client. */ hosted?: boolean;
} = {}) {
  const store: Store = createStore();
  const usage = { limited, blocking: limited, label: limited ? 'five-hour limit' : null, resetsAt: limited ? '2026-10-16T15:42:00.000Z' : null };
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ meta: { token: 't', levels: LEVELS, models: MODELS, jobOptions: { reviewers: REVIEWERS } }, jobs: [job('alpha', 'needs-you', { level: 1, ...jobExtra })], usage }) });
  const api = { get, post, ...(hosted ? { hosted: () => true } : {}) } as unknown as ApiClient;
  const reload = vi.fn();
  const view = (d: JobDetail) => (
    <WorkshopContext.Provider value={{ store, api }}>
      <UiProvider>
        <GateSlot job={store.getState().jobs[0]} detail={d} now={new Date()} reload={reload} />
        {composer && <Composer slug="alpha" detail={d} run={run} />}
      </UiProvider>
    </WorkshopContext.Provider>
  );
  const utils = render(view(det));
  return { ...utils, post, reload, store, show: (d: JobDetail) => utils.rerender(view(d)) };
}

const card = () => screen.queryByRole('region', { name: /Plan v2 ready|your reply is in the message box/ });
const button = (name: string | RegExp) => within(card()!).getByRole('button', { name });

afterEach(() => { localStorage.clear(); });

/** The two disclosures ("Adjust the next step", the decisions made for you) open, as a reader who opened them once has them. */
const disclosuresOpen = () => { writeStored('fw.gate.adjust', 'open'); writeStored('fw.gate.decided', 'open'); };
const offList = () => card()!.querySelector('.gate-off');

describe('GateCard', () => {
  beforeEach(disclosuresOpen);

  it('shows while the Foreman waits on a brief no gate reply answered, and hides otherwise', () => {
    const { show } = setup();
    expect(card()).not.toBeNull();
    show(detail(null));
    expect(card(), 'not waiting').toBeNull();
    show(detail({}, { answeredBriefs: [1, 2] }));
    expect(card(), 'answered from a gate card').toBeNull();
    show(detail({}, { heldReply: { kind: 'approve', gateBrief: 2, at: '2026-10-16T10:00:00Z' } }));
    expect(card(), 'held until the usage limit resets').toBeNull();
    show(detail({}, { heldReply: { kind: 'approve', gateBrief: 1, at: '2026-10-16T10:00:00Z' }, answeredBriefs: [1] }));
    expect(card(), 'an older brief’s held reply doesn’t count').not.toBeNull();
    show(detail({}, { heldReply: { kind: 'message', gateBrief: 2, at: '2026-10-16T10:00:00Z' } }));
    expect(card(), 'held guidance (“Other guidance”) doesn’t decide the brief').not.toBeNull();
  });

  it('a proof stamp: the commit the checks ran on, and a warning once the branch moved on', () => {
    const { unmount } = setup({ det: detail({ proof: { tested: '5d3f1d0', head: '5d3f1d0abc', stale: false, reportAt: null } }) });
    expect(document.querySelector('.gate-proof')).toHaveTextContent('Checked at 5d3f1d0, the branch’s head');
    unmount();
    setup({ det: detail({ proof: { tested: '5d3f1d0', head: '9a8b7c6d', stale: true, reportAt: null } }) });
    expect(document.querySelector('.gate-proof.is-stale')).toHaveTextContent('Checks ran on 5d3f1d0; the branch is now at 9a8b7c6. Ask for the checks again before approving.');
  });

  it('never shows on a job marked done', () => {
    setup({ jobExtra: { closed: { as: 'done' } } });
    expect(card()).toBeNull();
  });

  it('has the brief, stage, waiting time, next step and a parked chip (in words)', () => {
    // A fixed midday clock (Date only), so "2 hours ago" is the same day whenever the test runs:
    // just after midnight it would be yesterday's and read "waiting since yesterday".
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 10, 13, 0));
    try {
      const waitingSince = new Date(Date.now() - 2 * 3600_000).toISOString();
      const { show } = setup({ det: detail({ waitingSince }) });
      const c = card()!;
      expect(within(c).getByRole('heading', { level: 3 })).toHaveTextContent('Plan v2 ready');
      expect(c).toHaveTextContent('Brief 2 · Plan');
      expect(c).toHaveTextContent('waiting 2h');
      expect(c).toHaveTextContent('Next, as proposed: Build step 1');
      expect(within(c).queryByText('parked 4h')).toBeNull();
      show(detail({ waitingSince, parked: true, usage: 'Claude’s five-hour limit is at 85%: Build may pause part-way.' }));
      expect(within(card()!).getByText('parked 4h')).toHaveAttribute('title', expect.stringContaining('more than 4 hours'));
      expect(card()).toHaveTextContent('Claude’s five-hour limit is at 85%');
    } finally {
      vi.useRealTimers();
    }
  });

  it('picks the recommendation, labelled Recommended; questions are labelled radio groups with Your own answer', () => {
    setup();
    const q1 = screen.getByRole('group', { name: '1. Keep the old column?' });
    expect(within(q1).getByRole('radio', { name: /a\) Yes/ })).toBeChecked();
    expect(within(q1).getByRole('radio', { name: /a\) Yes/ }).closest('label')).toHaveTextContent('Recommended');
    expect(within(q1).getByRole('radio', { name: /b\) No/ })).not.toBeChecked();
    expect(within(q1).getByRole('radio', { name: 'Your own answer' })).not.toBeChecked();
    const q2 = screen.getByRole('group', { name: '2. What should the button say?' });
    expect(within(q2).queryByRole('radio')).toBeNull();
    expect(within(q2).getByRole('textbox', { name: 'Your answer to question 2' })).toBeInTheDocument();
  });

  it('names what Approve does, from the versions and the next stage', () => {
    const { show } = setup({ det: oneQ() });
    expect(button('Approve quick plan v2 and start Build')).toHaveAttribute('title', expect.stringContaining('The Foreman goes ahead with: Build step 1.'));
    show(oneQ({ versions: null, raisedVersions: null, nextStage: null }));
    expect(button('Approve and go ahead')).toBeInTheDocument();
    show(oneQ({ stage: 'spec', nextStage: 'refine', versions: { spec: '0.3', artifacts: {} }, raisedVersions: { spec: '0.3', artifacts: {} } }));
    expect(button('Approve spec v0.3 and start Refine')).toBeInTheDocument();
    show(oneQ({ versions: { spec: null, artifacts: { 'implementation-plan': '3', Findings: '1' } }, raisedVersions: { spec: null, artifacts: { 'implementation-plan': '2', Findings: '1' } } }));
    expect(button('Approve plan v2 and start Build'), 'the version it was raised at').toBeInTheDocument();
  });

  it('has one primary button, Approve; the other decisions are links on one line; Stop stays under ⋯', () => {
    setup({ det: oneQ() });
    const c = card()!;
    expect([...c.querySelectorAll('.btn-primary')].map((b) => b.textContent)).toEqual(['Approve quick plan v2 and start Build']);
    const links = c.querySelector('.gate-links')!;
    expect([...links.querySelectorAll('button.link-button')].map((b) => b.textContent)).toEqual(['Edit, then approve', 'Revise with feedback', 'Other guidance']);
    expect(button('More actions')).toBeInTheDocument();
    expect(offList(), 'every question answered: nothing is off').toBeNull();
  });

  it('folds the chips into “Adjust the next step” and the decisions into one line, closed until opened, remembered per browser', () => {
    localStorage.clear();
    const { unmount } = setup();
    const c = card()!;
    const adjust = c.querySelector<HTMLDetailsElement>('.gate-adjust')!;
    const decided = c.querySelector<HTMLDetailsElement>('.gate-decided')!;
    expect(adjust.open).toBe(false);
    expect(decided.open).toBe(false);
    expect(adjust.querySelector('summary')).toHaveTextContent('Adjust the next step (Build)');
    expect(decided.querySelector('summary')).toHaveTextContent('2 decisions made for you');
    expect(decided.querySelector('summary')).toHaveTextContent('Review');
    fireEvent.click(adjust.querySelector('summary')!);
    expect(adjust.open).toBe(true);
    fireEvent.click(button('Heavier (Build)'));
    expect(adjust.querySelector('summary'), 'the summary counts what is chosen').toHaveTextContent('1 chosen');
    expect(c).toHaveTextContent('Added to your reply, exactly:');
    fireEvent.click(adjust.querySelector('summary')!);
    expect(adjust.open, 'closed again; the chip stays chosen').toBe(false);
    expect(adjust.querySelector('.gate-chip[aria-pressed="true"]')).toHaveTextContent('Heavier');
    expect(adjust.querySelector('summary')).toHaveTextContent('1 chosen');
    fireEvent.click(decided.querySelector('summary')!);
    expect(decided.open).toBe(true);
    expect(decided.querySelector('summary')).toHaveTextContent('Hide');
    expect(screen.getByRole('region', { name: 'Decided on your behalf' })).toHaveTextContent('Toast text is “Copied”');
    expect(screen.getByRole('region', { name: 'Decided on your behalf' })).toHaveTextContent('Going ahead confirms the ones you don’t override.');
    unmount();
    // Remembered: a new card opens the way you left them.
    setup();
    expect(card()!.querySelector<HTMLDetailsElement>('.gate-adjust')!.open).toBe(false);
    expect(card()!.querySelector<HTMLDetailsElement>('.gate-decided')!.open).toBe(true);
  });

  it('names only the stage’s own artifact, never the spec or the last one for another stage; says when you do the next part', () => {
    const { show } = setup();
    fireEvent.click(button('I’ll do this part (Build)'));
    expect(button('Approve quick plan v2; you do Build yourself')).toBeInTheDocument();
    // A review gate with only the plan and the spec versioned: neither is what it approves.
    show(detail({ stage: 'review', nextStage: 'pr1', versions: { spec: '0.3', artifacts: { 'Quick plan': '2' } }, raisedVersions: { spec: '0.3', artifacts: { 'Quick plan': '2' } } }));
    expect(button('Approve and start PR #1')).toBeInTheDocument();
    show(detail({ stage: 'pr1', nextStage: 'pr2', versions: { spec: '0.3', artifacts: { 'Quick plan': '2' } }, raisedVersions: { spec: '0.3', artifacts: { 'Quick plan': '2' } } }));
    expect(button('Approve and start PR #2')).toBeInTheDocument();
    show(detail({ stage: 'pr3', nextStage: null, versions: { spec: '0.3', artifacts: {} }, raisedVersions: { spec: '0.3', artifacts: {} } }));
    expect(button('Approve and go ahead')).toBeInTheDocument();
    show(detail({ stage: 'review', nextStage: 'pr1', versions: { spec: null, artifacts: { 'Review findings': '1' } }, raisedVersions: { spec: null, artifacts: { 'Review findings': '1' } } }));
    expect(button('Approve review findings v1 and start PR #1')).toBeInTheDocument();
  });

  it('a later gate doesn’t borrow the plan, the test plan or the findings of an earlier stage', () => {
    const { show } = setup();
    const at = (stage: string, nextStage: string | null, artifacts: Record<string, string>) => {
      const v = { spec: '0.2', artifacts };
      show(detail({ stage, nextStage, versions: v, raisedVersions: v }));
    };
    const all = { Findings: '1', 'Implementation plan': '2', 'Test plan': '2' };
    at('implement', 'test', all);
    expect(button('Approve and start Test'), 'the build gate approves the build, not plan v2').toBeInTheDocument();
    at('test', 'review', all);
    expect(button('Approve and start Review'), 'not the test plan').toBeInTheDocument();
    at('review', 'pr1', all);
    expect(button('Approve and start PR #1'), 'not the investigation’s findings').toBeInTheDocument();
    at('plan', 'implement', { 'Test plan': '3', 'Implementation plan': '3' });
    expect(button('Approve plan v3 and start Build'),'the plan, even listed after the test plan').toBeInTheDocument();
    at('implement', 'test', { ...all, Build: '1' });
    expect(button('Approve build v1 and start Test')).toBeInTheDocument();
    at('test', 'review', { ...all, 'Test report': '1' });
    expect(button('Approve test report v1 and start Review')).toBeInTheDocument();
  });

  it('Approve sends the answers, confirms the decisions not overridden, and the chips', async () => {
    const { post } = setup();
    fireEvent.change(screen.getByRole('textbox', { name: 'Your answer to question 2' }), { target: { value: 'Copy ID' } });
    fireEvent.click(button('Lighter (Build)'));
    await act(async () => { fireEvent.click(button('Approve quick plan v2 and start Build')); });
    expect(post).toHaveBeenCalledWith('/api/job/alpha/gate', {
      kind: 'approve', briefNumber: 2,
      answers: { 1: { choice: 'a' }, 2: { other: 'Copy ID' } },
      verdicts: { 'D-1': { verdict: 'confirm' }, 'D-2': { verdict: 'confirm' } },
      chips: [{ kind: 'lighter', stage: 'implement' }],
    });
  });

  it('Override flips a decision to changed with your note; with nothing said yet, Approve is off and says why', async () => {
    const { post } = setup({ det: oneQ() });
    const list = screen.getByRole('region', { name: 'Decided on your behalf' });
    expect(within(list).queryByText('Already settled')).toBeNull(); // confirmed ones aren't listed again
    const item = within(list).getByText('Toast text is “Copied”').closest('li')!;
    fireEvent.click(within(item).getByRole('button', { name: 'Override' }));
    expect(item).toHaveTextContent('Changed');
    expect(button(/^Approve quick plan/)).toBeDisabled();
    expect(offList()).toHaveTextContent('Approve is off:');
    expect(offList()).toHaveTextContent('Say what “Toast text is “Copied”” should be instead, or undo that override.');
    expect(post).not.toHaveBeenCalled();
    fireEvent.change(within(item).getByRole('textbox', { name: 'What should it be instead?' }), { target: { value: 'Say “Copied to clipboard”' } });
    expect(offList(), 'resolved: the list is gone').toBeNull();
    await act(async () => { fireEvent.click(button(/^Approve quick plan/)); });
    expect(post.mock.calls[0][1].verdicts).toEqual({ 'D-1': { verdict: 'confirm' }, 'D-2': { verdict: 'change', note: 'Say “Copied to clipboard”' } });
  });

  it('chips are pressed toggles that show the exact lines sent, one per group, with the level’s consequence', () => {
    setup();
    expect(screen.queryByText(/Added to your reply/)).toBeNull();
    fireEvent.click(button('Heavier (Build)'));
    expect(button('Heavier (Build)')).toHaveAttribute('aria-pressed', 'true');
    expect(button('Heavier (Build)')).toHaveTextContent('✓ Heavier');
    fireEvent.click(button('Lighter (Build)'));
    expect(button('Heavier (Build)'), 'one way to run the next stage at a time').toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(button('Raise the level to L2'));
    fireEvent.click(button('I’ll do this part (Build)'));
    const lines = card()!.querySelector('.gate-lines-text')!;
    expect(lines.textContent).toBe("Option change for the next step: I'll do implement myself\nOption change for the next step: level L2 (was L1)");
    // At a plan gate the spec stages are behind the job, so they aren't named.
    expect(card()).toHaveTextContent('L1→L2 adds: tester, Locksmith + Gauge + Stickler lenses.');
    expect(card()).not.toHaveTextContent('spec update');
    fireEvent.click(button('Raise the level to L2'));
    expect(lines.textContent).toBe("Option change for the next step: I'll do implement myself");
  });

  it('at a plan gate, L2→L3 leaves out the product interview (already behind the job) and names what is still ahead', () => {
    setup({ det: detail({ level: 2 }, { options: { level: 2 } }), jobExtra: { level: 2 } });
    fireEvent.click(button('Raise the level to L3'));
    expect(card()).toHaveTextContent('L2→L3 adds: Fable at plan + review, Fuse + Mason + Stopwatch + Painter lenses.');
    expect(card()).not.toHaveTextContent('product interview');
  });

  it('chips that don’t apply are off, with a hint saying why', () => {
    const { show } = setup();
    expect(button('Skip next (Build)')).toHaveAttribute('aria-disabled', 'true');
    expect(button('Skip next (Build)')).toHaveAttribute('title', 'Build can’t be skipped: it’s the work itself.');
    fireEvent.click(button('Skip next (Build)'));
    expect(button('Skip next (Build)')).toHaveAttribute('aria-pressed', 'false');
    show(detail({ nextStage: 'review', level: 3 }));
    expect(button('Skip next (Review)')).not.toHaveAttribute('aria-disabled');
    expect(button('Ask Fable (the review)')).not.toHaveAttribute('aria-disabled');
    expect(button('Raise the level')).toHaveAttribute('title', 'Already L3, the highest level.');
    expect(button('Raise the level')).toHaveAttribute('aria-disabled', 'true');
    show(detail({ nextStage: 'plan' }, { options: { level: 1, fable_checks: ['plan'] } }));
    expect(button('Ask Fable (the plan)')).toHaveAttribute('title', 'Fable already looks at the plan for this job.');
  });

  it('Ask Fable adds the first Fable point at or after the next stage', async () => {
    const { post, show } = setup({ det: oneQ() });
    // Next is Build: Fable's next point is the review.
    const fable = button('Ask Fable (the review)');
    expect(fable).not.toHaveAttribute('aria-disabled');
    expect(fable).toHaveAttribute('title', expect.stringContaining('the first point it can look at from Build on'));
    fireEvent.click(fable);
    expect(card()!.querySelector('.gate-lines-text')!.textContent).toBe('Option change for the next step: ask Fable at review');
    await act(async () => { fireEvent.click(button(/^Approve quick plan/)); });
    expect(post.mock.calls[0][1].chips).toEqual([{ kind: 'fable', point: 'review' }]);
    // Sent: the card's calls rest until the job moves on, as it does here (a new brief, a new run).
    act(() => { clearAllSent(); clearGateSent(); });
    show(oneQ({ nextStage: 'investigate' }));
    expect(button('Ask Fable (the plan)')).not.toHaveAttribute('aria-disabled');
    show(oneQ({ nextStage: 'refine' }));
    expect(button('Ask Fable (the spec)')).not.toHaveAttribute('aria-disabled');
    show(oneQ({ nextStage: 'pr2' }));
    expect(button('Ask Fable (the PR)')).not.toHaveAttribute('aria-disabled');
    show(oneQ({ nextStage: 'implement' }, { options: { level: 1, fable_checks: ['review'] } }));
    expect(button('Ask Fable (the review)')).toHaveAttribute('aria-disabled', 'true');
    show(oneQ({ nextStage: null }));
    expect(button('Ask Fable')).toHaveAttribute('aria-disabled', 'true');
  });

  it('with a question left unanswered, Approve is off and the list names the question; it empties as you answer', async () => {
    const { post } = setup();
    // Question 1 has its recommendation picked; question 2 has no options and nothing written.
    const approve = button(/^Approve quick plan/);
    expect(approve).toBeDisabled();
    expect(approve).toHaveAttribute('title', expect.stringContaining('Off: Question 2 has no answer.'));
    expect(within(card()!).getByRole('status', { name: 'Approve is off:' })).toHaveTextContent('Question 2 has no answer. Pick one, or write your own.');
    fireEvent.click(button('Edit, then approve'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(card()!).getByRole('alert')).toHaveTextContent('Question 2 has no answer.');
    // "Your own answer" picked on question 1 with nothing written: no answer either.
    fireEvent.change(screen.getByRole('textbox', { name: 'Your answer to question 2' }), { target: { value: 'Copy ID' } });
    expect(offList(), 'question 2 answered').toBeNull();
    fireEvent.click(within(screen.getByRole('group', { name: '1. Keep the old column?' })).getByRole('radio', { name: 'Your own answer' }));
    expect(offList()).toHaveTextContent('Question 1 has no answer.');
    expect(button(/^Approve quick plan/)).toBeDisabled();
    fireEvent.click(within(screen.getByRole('group', { name: '1. Keep the old column?' })).getByRole('radio', { name: /a\) Yes/ }));
    expect(offList()).toBeNull();
    await act(async () => { fireEvent.click(button(/^Approve quick plan/)); });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][1].answers).toEqual({ 1: { choice: 'a' }, 2: { other: 'Copy ID' } });
  });

  it('with no level, L↑ and L↓ are off and point to the level chip', () => {
    // The page's level chip (the job page's header has one).
    const chip = document.createElement('button');
    chip.className = 'chip level-chip';
    document.body.append(chip);
    try {
      setup({ det: detail({ level: null }), jobExtra: { level: null } });
      expect(button('Raise the level')).toHaveAttribute('aria-disabled', 'true');
      expect(button('Lower the level')).toHaveAttribute('title', 'Pick a level first: this job has none yet.');
      expect(button('Pick a level first')).toBeInTheDocument();
    } finally { chip.remove(); }
  });

  // Final review A6 (calls Minor 4): no level chip on the page (the phone), no link to one.
  it('with no level chip on the page, Pick a level first is not offered', () => {
    setup({ det: detail({ level: null }), jobExtra: { level: null } });
    expect(screen.getByText(/L↑ and L↓ need a level\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pick a level first' })).toBeNull();
  });

  it('greys out when the plan changed since it was proposed: approvals off, the rest still work', async () => {
    const { post, reload } = setup({ det: detail({ stale: true }), limited: true });
    const c = card()!;
    expect(c).toHaveClass('is-stale');
    expect(c).toHaveTextContent('Plan changed since this was proposed');
    expect(button(/^Approve quick plan/)).toBeDisabled();
    expect(offList()).toHaveTextContent('The plan changed since this card was raised');
    expect(button('Edit, then approve')).toBeDisabled();
    expect(button('Approve, start after reset')).toBeDisabled();
    expect(button('Revise with feedback')).toBeEnabled();
    expect(button('Other guidance')).toBeEnabled();
    expect(button('More actions')).toBeEnabled();
    fireEvent.click(button('Check again'));
    expect(reload).toHaveBeenCalledTimes(1);
    fireEvent.click(button('Revise with feedback'));
    const send = button('Send back');
    expect(send).toBeDisabled(); // a note is required
    fireEvent.change(within(c).getByRole('textbox', { name: /What should change/ }), { target: { value: 'Split step 2.' } });
    await act(async () => { fireEvent.click(send); });
    expect(post).toHaveBeenCalledWith('/api/job/alpha/gate', expect.objectContaining({ kind: 'changes', note: 'Split step 2.', verdicts: {} }));
  });

  it('a 409 for a brief the Foreman moved on from refetches the job and says so plainly', async () => {
    const post = vi.fn(async () => { throw new ApiError(409, 'The Foreman has moved on to brief 3 since this card was shown. Nothing was sent; decide on the new brief.', { code: 'stale-brief', briefNumber: 3 }); });
    const { reload } = setup({ post, det: oneQ() });
    await act(async () => { fireEvent.click(button(/^Approve quick plan/)); });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toHaveTextContent('moved on to brief 3');
    expect(screen.getByRole('alert')).toHaveFocus();
  });

  it('a 409 for a plan that changed since the card was raised is handled the same way', async () => {
    const post = vi.fn(async () => { throw new ApiError(409, 'The spec or plan changed since this card was shown. Nothing was sent; read the new version, then decide.', { code: 'stale-gate' }); });
    const { reload } = setup({ post, det: oneQ() });
    await act(async () => { fireEvent.click(button(/^Approve quick plan/)); });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toHaveTextContent('The spec or plan changed since this card was shown.');
    expect(screen.getByRole('alert')).toHaveFocus();
  });

  it('Edit, then approve: Send turns off when the plan changes while the sheet is open; closing it returns focus', () => {
    const { show, post } = setup({ det: oneQ() });
    fireEvent.click(button('Edit, then approve'));
    let dialog = screen.getByRole('dialog', { name: 'Edit, then approve' });
    expect(within(dialog).getByRole('button', { name: 'Approve with this text' })).toBeEnabled();
    show(oneQ({ stale: true }));
    dialog = screen.getByRole('dialog', { name: 'Edit, then approve' });
    const send = within(dialog).getByRole('button', { name: 'Approve with this text' });
    expect(send).toBeDisabled();
    expect(within(dialog).getByRole('alert')).toHaveTextContent('The plan changed since this card was raised');
    fireEvent.keyDown(within(dialog).getByRole('textbox'), { key: 'Enter', metaKey: true });
    expect(post).not.toHaveBeenCalled();
    show(oneQ());
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button('Edit, then approve'), 'closed without sending: focus back on its button').toHaveFocus();
  });

  it('shows a 400 inline on the card', async () => {
    const post = vi.fn(async () => { throw new ApiError(400, 'Pick a level for this job first.'); });
    setup({ post, det: oneQ() });
    await act(async () => { fireEvent.click(button(/^Approve quick plan/)); });
    expect(within(card()!).getByRole('alert')).toHaveTextContent('Pick a level for this job first.');
  });

  it('on success says what was sent and how the job runs now; the card goes once the brief is answered', async () => {
    const post = vi.fn(async () => ({ ...SENT, options: { level: 2 }, summary: ['Level: L2 Standard (small flow)', 'Skipped: refine'] }));
    const { reload, show } = setup({ post, det: oneQ() });
    fireEvent.click(button('Raise the level to L2'));
    await act(async () => { fireEvent.click(button(/^Approve quick plan/)); });
    const note = screen.getByText('Your approval went to the Foreman.').closest<HTMLElement>('.gate-notice')!;
    expect(note).toHaveAttribute('role', 'status');
    expect(within(note).getByRole('list', { name: 'How the job runs from the next step' })).toHaveTextContent('Level: L2 Standard (small flow)');
    expect(note).toHaveFocus();
    expect(reload).toHaveBeenCalled();
    show(detail({}, { answeredBriefs: [2] }));
    expect(card()).toBeNull();
    expect(screen.getByText('Your approval went to the Foreman.')).toBeInTheDocument();
  });

  it('Edit, then approve: the composed reply in an editable preview, sent as the approval', async () => {
    const post = vi.fn(async () => ({ ...SENT, text: 'edited' }));
    setup({ post, det: oneQ() });
    fireEvent.click(button('Heavier (Build)'));
    fireEvent.click(button('Edit, then approve'));
    const dialog = screen.getByRole('dialog', { name: 'Edit, then approve' });
    const box = within(dialog).getByRole('textbox');
    expect(box).toHaveValue([
      'My answers to brief 2:', '1. Keep the old column? → a) Yes', '',
      'Decided on my behalf, confirmed: D-1, D-2.', '',
      'Option change for the next step: heavier implement', '',
      'I approve. Go ahead with the next stage: Build step 1', 'At these versions: Quick plan v2.',
    ].join('\n'));
    expect(box).toHaveFocus();
    fireEvent.change(box, { target: { value: 'I approve. Call the button “Copy ID”.' } });
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Approve with this text' })); });
    expect(post).toHaveBeenCalledWith('/api/job/alpha/gate', expect.objectContaining({
      kind: 'approve', briefNumber: 2, text: 'I approve. Call the button “Copy ID”.', chips: [{ kind: 'heavier', stage: 'implement' }],
    }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Your approval went to the Foreman.')).toBeInTheDocument();
  });

  it('Approve, start after reset shows only at the usage limit, and holds the reply', async () => {
    const post = vi.fn(async () => ({ ok: true, sent: false, held: true, text: 'x', message: 'Held: it goes to the Foreman when Claude’s usage limit resets (around 3:42 PM).' }));
    setup({ post, limited: true, det: oneQ() });
    await act(async () => { fireEvent.click(button('Approve, start after reset')); });
    expect(post).toHaveBeenCalledWith('/api/job/alpha/gate', expect.objectContaining({ kind: 'approve', startAfterReset: true }));
    expect(screen.getByText(/^Held: it goes to the Foreman/)).toBeInTheDocument();
    expect(localStorage.getItem(draftKey('alpha')), 'held, not in the composer').toBeNull();
  });

  it('without the usage limit, there is no “start after reset”', () => {
    setup();
    expect(within(card()!).queryByRole('button', { name: 'Approve, start after reset' })).toBeNull();
  });

  it('Stop is behind ⋯ and needs the job’s name typed; Escape closes the menu', async () => {
    const { post } = setup();
    const more = button('More actions');
    fireEvent.click(more);
    expect(screen.getByRole('menuitem', { name: 'Stop job…' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(more).toHaveFocus();
    fireEvent.click(more);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Stop job…' }));
    const stop = button('Stop the job');
    expect(stop).toBeDisabled();
    const name = within(card()!).getByRole('textbox', { name: /Type the job’s name/ });
    expect(name).toHaveFocus();
    fireEvent.change(name, { target: { value: 'alph' } });
    expect(stop).toBeDisabled();
    fireEvent.change(name, { target: { value: 'alpha' } });
    fireEvent.click(button('Lighter (Build)')); // chips never go with a stop
    await act(async () => { fireEvent.click(stop); });
    expect(post).toHaveBeenCalledWith('/api/job/alpha/gate', { kind: 'stop', briefNumber: 2, note: '' });
  });

  it('without the bar the card’s help keeps Other guidance and Revise with feedback', () => {
    setup({ det: detail({ questions: [] }) });
    const help = card()!.querySelector('.how-body')!;
    expect(help).toHaveTextContent('Other guidance');
    expect(help).toHaveTextContent('Revise with feedback');
  });

  it('Other guidance sends a note and the answers picked as a message', async () => {
    const { post } = setup();
    fireEvent.click(button('Other guidance'));
    expect(button('Send the reply')).toBeEnabled(); // the recommended answer is picked: answers alone are a reply
    fireEvent.change(within(card()!).getByRole('textbox', { name: /Your answers or a note for the Foreman/ }), { target: { value: 'Is the CSV in scope?' } });
    await act(async () => { fireEvent.click(button('Send the reply')); });
    expect(post).toHaveBeenCalledWith('/api/job/alpha/gate', expect.objectContaining({ kind: 'message', note: 'Is the CSV in scope?', answers: { 1: { choice: 'a' } }, verdicts: {} }));
  });

  it('while the Foreman works, the reply waits in the composer with its brief; Send then carries gateBrief', async () => {
    const text = 'Not confirmed yet: D-1, D-2.\n\nOption change for the next step: lighter implement\n\nAlso check the CSV.';
    const post = vi.fn(async (path: string) => (path.endsWith('/gate')
      ? { ok: true, sent: false, queued: false, text, options: { level: 1 }, message: 'The Foreman is still working on a reply, so nothing was sent.' }
      : {}));
    const { show } = setup({ post, det: detail({ runActive: true }), composer: true });
    expect(card()).toHaveTextContent('The Foreman is still working on a reply.');
    fireEvent.click(button('Lighter (Build)'));
    fireEvent.click(button('Other guidance'));
    fireEvent.change(within(card()!).getByRole('textbox', { name: /Your answers or a note for the Foreman/ }), { target: { value: 'Also check the CSV.' } });
    await act(async () => { fireEvent.click(button('Send the reply')); });
    expect(screen.getByText(/The Foreman is still working; your reply is ready to send when it finishes\./)).toHaveTextContent('The option changes are saved already.');
    const composerBox = screen.getByRole('textbox', { name: 'Your message to the Foreman' });
    expect(composerBox).toHaveValue(text);
    expect(composerBox).toHaveFocus();
    expect(JSON.parse(localStorage.getItem(gateDraftKey('alpha'))!)).toEqual({ brief: 2, kind: 'message', text });
    // The card now says where the reply is, instead of asking again.
    show(detail({ runActive: false }));
    expect(within(card()!).getByRole('heading', { level: 3 })).toHaveTextContent('Brief 2: your reply is in the message box');
    expect(screen.getByText(/This is your reply to brief 2 from its card/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send…' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send to the Foreman' })); });
    expect(post).toHaveBeenLastCalledWith('/api/job/alpha/send', { kind: 'message', text, confirmNoTerminal: false, gateBrief: 2 });
    expect(localStorage.getItem(gateDraftKey('alpha'))).toBeNull();
    expect(localStorage.getItem(draftKey('alpha'))).toBeNull();
  });

  it('“Decide again here” turns the waiting reply into a plain message and brings the card back', () => {
    localStorage.setItem(draftKey('alpha'), 'I approve.');
    localStorage.setItem(gateDraftKey('alpha'), JSON.stringify({ brief: 2, kind: 'approve', text: 'I approve.' }));
    setup();
    fireEvent.click(button('Decide again here'));
    expect(within(card()!).getByRole('heading', { level: 3 })).toHaveTextContent('Plan v2 ready');
    expect(localStorage.getItem(draftKey('alpha'))).toBe('I approve.');
  });

  it('the waiting card says whether the Foreman is still working or has finished', () => {
    localStorage.setItem(draftKey('alpha'), 'I approve.');
    localStorage.setItem(gateDraftKey('alpha'), JSON.stringify({ brief: 2, kind: 'approve', text: 'I approve.' }));
    const { show } = setup({ det: detail({ runActive: true }, { run: { id: 'r1', slug: 'alpha', status: 'running' } }) });
    expect(card()).toHaveTextContent('Send it once the Foreman finishes the reply in progress.');
    show(detail({ runActive: false }, { run: { id: 'r1', slug: 'alpha', status: 'done' } }));
    expect(card()).toHaveTextContent('The Foreman has finished; send your reply from the message box.');
  });

  it('deciding again replaces the earlier decision in the box when it is unchanged, else keeps both and says so', async () => {
    const reply = (text: string) => vi.fn(async () => ({ ok: true, sent: false, queued: false, text, message: 'still working' }));
    const working = oneQ({ runActive: true });
    // Unchanged: replaced.
    localStorage.setItem(draftKey('alpha'), 'OLD decision');
    localStorage.setItem(gateDraftKey('alpha'), JSON.stringify({ brief: 2, kind: 'approve', text: 'OLD decision' }));
    const first = setup({ det: working, post: reply('NEW decision') });
    fireEvent.click(button('Decide again here'));
    await act(async () => { fireEvent.click(button('Revise with feedback')); });
    fireEvent.change(within(card()!).getByRole('textbox', { name: /What should change/ }), { target: { value: 'Split step 2.' } });
    await act(async () => { fireEvent.click(button('Send back')); });
    expect(localStorage.getItem(draftKey('alpha'))).toBe('NEW decision');
    expect(JSON.parse(localStorage.getItem(gateDraftKey('alpha'))!)).toEqual({ brief: 2, kind: 'changes', text: 'NEW decision' });
    expect(screen.getByText(/It replaces your earlier reply to this brief\./)).toBeInTheDocument();
    first.unmount();
    localStorage.clear();

    // Edited since: both stay, and the note says so.
    localStorage.setItem(draftKey('alpha'), 'OLD decision. And a thought of mine.');
    localStorage.setItem(gateDraftKey('alpha'), JSON.stringify({ brief: 2, kind: 'approve', text: 'OLD decision' }));
    setup({ det: working, post: reply('NEW decision') });
    fireEvent.click(button('Decide again here'));
    await act(async () => { fireEvent.click(button(/^Approve quick plan/)); });
    expect(localStorage.getItem(draftKey('alpha'))).toBe('OLD decision. And a thought of mine.\n\nNEW decision');
    expect(screen.getByText(/What was already in the box is still there, above it: delete what you don’t want before sending, or both go\./)).toBeInTheDocument();
  });

  it('in stop mode the chips’ lines are hidden (a stop carries none)', () => {
    setup({ det: oneQ() });
    fireEvent.click(button('Lighter (Build)'));
    expect(screen.getByText('Added to your reply, exactly:')).toBeInTheDocument();
    fireEvent.click(button('More actions'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Stop job…' }));
    expect(screen.queryByText('Added to your reply, exactly:')).toBeNull();
    expect(within(card()!).getByRole('textbox', { name: /Type the job’s name/ })).toHaveAttribute('title', expect.stringContaining('Type alpha exactly'));
    expect(within(card()!).getByRole('textbox', { name: /A note for the Foreman/ })).toHaveAttribute('title');
  });

  it('Stop job while the Foreman works ends that reply first, then the stop waits in the message box', async () => {
    const post = vi.fn(async (path: string, _body?: unknown) => (path.endsWith('/gate') ? { ok: true, sent: false, queued: false, text: 'Please stop here.', message: 'still working' } : {}));
    const run = { id: 'r1', slug: 'alpha', status: 'running' } as Run;
    setup({ post, det: oneQ({ runActive: true }, { run }), composer: true, run });
    fireEvent.click(button('More actions'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Stop job…' }));
    expect(card()).toHaveTextContent('stopping the job ends that reply first, then your stop waits in the message box until it has ended');
    fireEvent.change(within(card()!).getByRole('textbox', { name: /Type the job’s name/ }), { target: { value: 'alpha' } });
    await act(async () => { fireEvent.click(button('Stop the job')); });
    expect(post.mock.calls.map((c) => c[0])).toEqual(['/api/runs/r1/stop', '/api/job/alpha/gate']);
    expect(post.mock.calls[1][1]).toEqual({ kind: 'stop', briefNumber: 2, note: '' });
    expect(localStorage.getItem(draftKey('alpha'))).toBe('Please stop here.');
  });
});

describe('Composer and gate replies', () => {
  it('a plain draft sends no gateBrief; emptying the box forgets that it was a gate reply', async () => {
    localStorage.setItem(draftKey('alpha'), 'I approve.');
    localStorage.setItem(gateDraftKey('alpha'), JSON.stringify({ brief: 2, kind: 'approve' }));
    const post = vi.fn(async () => ({}));
    setup({ post, det: detail(null, { statusForCompose: { brief: { number: 2 } } }), composer: true });
    const box = screen.getByRole('textbox', { name: 'Your message to the Foreman' });
    fireEvent.change(box, { target: { value: '' } });
    expect(localStorage.getItem(gateDraftKey('alpha'))).toBeNull();
    fireEvent.change(box, { target: { value: 'Something else.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send…' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send to the Foreman' })); });
    expect(post).toHaveBeenCalledWith('/api/job/alpha/send', { kind: 'message', text: 'Something else.', confirmNoTerminal: false });
  });

  it('a gate reply in the box goes with its kind and brief', async () => {
    localStorage.setItem(draftKey('alpha'), 'I approve. Go ahead.');
    localStorage.setItem(gateDraftKey('alpha'), JSON.stringify({ brief: 2, kind: 'approve' }));
    const post = vi.fn(async () => ({}));
    setup({ post, det: detail(null), composer: true });
    fireEvent.click(screen.getByRole('button', { name: 'Send…' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send to the Foreman' })); });
    expect(post).toHaveBeenCalledWith('/api/job/alpha/send', { kind: 'approve', text: 'I approve. Go ahead.', confirmNoTerminal: false, gateBrief: 2 });
  });

  it('a gate reply for a brief the Foreman moved on from is not sent: the memo goes, the text stays, and it says so', async () => {
    localStorage.setItem(draftKey('alpha'), 'I approve. Go ahead.');
    localStorage.setItem(gateDraftKey('alpha'), JSON.stringify({ brief: 2, kind: 'approve', text: 'I approve. Go ahead.' }));
    const post = vi.fn(async () => { throw new ApiError(409, 'The Foreman has moved on to brief 3 since this card was shown.', { code: 'stale-brief', briefNumber: 3 }); });
    setup({ post, det: detail(null), composer: true });
    fireEvent.click(screen.getByRole('button', { name: 'Send…' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send to the Foreman' })); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('The Foreman moved on to brief 3; your reply to brief 2 wasn’t sent.');
    expect(localStorage.getItem(gateDraftKey('alpha'))).toBeNull();
    expect(localStorage.getItem(draftKey('alpha'))).toBe('I approve. Go ahead.');
    expect(screen.queryByText(/This is your reply to brief 2/)).toBeNull();
  });

  it('while the Foreman works, a gate reply can’t steer: Steer and ⌘Enter are off until it is made a plain message', async () => {
    localStorage.setItem(draftKey('alpha'), 'I approve. Go ahead.');
    localStorage.setItem(gateDraftKey('alpha'), JSON.stringify({ brief: 2, kind: 'approve', text: 'I approve. Go ahead.' }));
    const post = vi.fn(async () => ({ steer: { id: 's1', state: 'queued' } }));
    const run = { id: 'r1', slug: 'alpha', status: 'running' } as Run;
    setup({ post, det: detail(null), composer: true, run });
    expect(screen.getByText('This is your reply to brief 2 (an approval); it goes as its own message once the Foreman finishes. Make it a plain message to steer it.', { exact: false })).toBeInTheDocument();
    const steer = screen.getByRole('button', { name: 'Steer' });
    expect(steer).toBeDisabled();
    expect(steer).toHaveAttribute('title', expect.stringContaining('This is your reply to brief 2'));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Steer the reply in progress' }), { key: 'Enter', metaKey: true });
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Make it a plain message' }));
    expect(screen.getByRole('button', { name: 'Steer' })).toBeEnabled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Steer' })); });
    expect(post).toHaveBeenCalledWith('/api/runs/r1/steer', { text: 'I approve. Go ahead.' });
  });
});

describe('the gate card’s keys', () => {
  let off = () => {};
  beforeEach(() => { off = installKeyListener(); });
  afterEach(() => off());
  const hint = (b: HTMLElement) => b.querySelector('kbd')?.textContent ?? null;

  it('a approves a card with no questions on a job waiting for a go-ahead, and the buttons show their keys', async () => {
    const { post } = setup({ det: detail({ questions: [] }), jobExtra: { waitingFor: 'approval' } });
    expect(hint(button(/^Approve quick plan/))).toBe('a');
    expect(hint(button('Edit, then approve'))).toBe('e');
    expect(hint(button('Revise with feedback'))).toBe('r');
    expect(hint(button('Other guidance'))).toBe('o');
    await act(async () => { fireEvent.keyDown(document.body, { key: 'a' }); });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][1].kind).toBe('approve');
  });

  it('a never approves while the card asks questions; 1–3 pick an answer to the first open one', async () => {
    const { post } = setup({ det: detail({ questions: [{ ...QUESTIONS[0], recommendation: null }, QUESTIONS[1]] }), jobExtra: { waitingFor: 'answers' } });
    expect(hint(button(/^Approve quick plan/))).toBeNull();
    fireEvent.keyDown(document.body, { key: 'a' });
    await new Promise((r) => setTimeout(r, 20));
    expect(post).not.toHaveBeenCalled();
    const q1 = screen.getByRole('group', { name: '1. Keep the old column?' });
    expect(within(q1).getByRole('radio', { name: /b\) No/ })).not.toBeChecked();
    fireEvent.keyDown(document.body, { key: '2' });
    expect(within(q1).getByRole('radio', { name: /b\) No/ })).toBeChecked();
    // Question 1 answered: the first open one is now question 2, which has no options.
    fireEvent.keyDown(document.body, { key: '1' });
    expect(within(q1).getByRole('radio', { name: /b\) No/ })).toBeChecked();
  });

  it('. and v open and close the two disclosures; v does nothing on a card with no decisions', () => {
    localStorage.clear();
    const { show } = setup({ det: oneQ(), jobExtra: { waitingFor: 'approval' } });
    const adjust = () => card()!.querySelector<HTMLDetailsElement>('.gate-adjust')!;
    const decided = () => card()!.querySelector<HTMLDetailsElement>('.gate-decided')!;
    expect(adjust().querySelector('kbd')).toHaveTextContent('.');
    expect(decided().querySelector('kbd')).toHaveTextContent('v');
    fireEvent.keyDown(document.body, { key: '.' });
    expect(adjust().open).toBe(true);
    fireEvent.keyDown(document.body, { key: 'v' });
    expect(decided().open).toBe(true);
    fireEvent.keyDown(document.body, { key: '.' });
    fireEvent.keyDown(document.body, { key: 'v' });
    expect(adjust().open).toBe(false);
    expect(decided().open).toBe(false);
    fireEvent.click(screen.getByRole('radio', { name: 'Your own answer' }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Your own answer to question 1' }), { key: '.' });
    expect(adjust().open, 'not while typing').toBe(false);
    show(oneQ({ decided: [] }));
    expect(card()!.querySelector('.gate-decided')).toBeNull();
    const before = localStorage.getItem('fw.gate.decided');
    fireEvent.keyDown(document.body, { key: 'v' });
    expect(localStorage.getItem('fw.gate.decided'), 'nothing to open: the key is not taken').toBe(before);
  });

  it('r, o and e open Revise, Other guidance and the edit sheet; nothing while typing in the card', async () => {
    disclosuresOpen();
    setup({ det: oneQ(), jobExtra: { waitingFor: 'approval' } });
    fireEvent.keyDown(document.body, { key: 'r' });
    expect(button('Revise with feedback')).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('radio', { name: 'Your own answer' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Your own answer to question 1' }), { target: { value: 'Only for admins' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Your own answer to question 1' }), { key: 'o' });
    expect(button('Other guidance')).toHaveAttribute('aria-expanded', 'false');
    fireEvent.keyDown(document.body, { key: 'o' });
    expect(button('Other guidance')).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(document.body, { key: 'e' });
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});

// ---------- Clarify (consequences) and the screens stage ----------

describe('GateCard: clarify questions with consequences', () => {
  beforeEach(disclosuresOpen);

  it('shows each option’s consequence as one muted line under it, and nothing when there is none', () => {
    const questions: Gate['questions'] = [{
      id: '1', text: 'Which offices?', recommendation: 'a',
      options: [
        { id: 'a', label: 'Phoenix only', consequence: 'One office rule; ships this week' },
        { id: 'b', label: 'All offices', consequence: 'Needs the scoping lens; L3' },
        { id: 'c', label: 'Later' },
      ],
    }];
    setup({ det: detail({ stage: 'clarify', nextStage: 'spec', headline: 'Three questions before the spec', questions }) });
    const c = screen.getByRole('region', { name: 'Three questions before the spec' });
    expect(c).toHaveTextContent('Brief 2 · Clarify');
    const q = within(c).getByRole('group', { name: '1. Which offices?' });
    const lines = [...q.querySelectorAll('.answer-consequence')];
    expect(lines.map((l) => l.textContent)).toEqual(['One office rule; ships this week', 'Needs the scoping lens; L3']);
    expect(lines[0]).toHaveClass('muted');
    expect(lines[0]).toHaveAttribute('title', 'What changes if you pick this answer.');
    expect(within(q).getByRole('radio', { name: /a\) Phoenix only/ })).toBeChecked();
    expect(within(q).getByRole('radio', { name: /c\) Later/ }).closest('label')!.querySelector('.answer-consequence')).toBeNull();
    // Approve names the next stage as any gate does.
    expect(within(c).getByRole('button', { name: /^Approve/ })).toHaveTextContent('start Spec');
  });
});

describe('GateCard: the screens stage', () => {
  beforeEach(disclosuresOpen);
  afterEach(() => { clearWireframes(); window.location.hash = ''; });

  const WIREFRAMES_JSON = JSON.stringify({ version: 1, screens: [{ key: 's-list', name: 'The list', states: [] }], choices: [{ key: 'c-entry', question: 'Where the button goes', options: [] }] });
  const screensGate = (): JobDetail => detail({ stage: 'wireframe', nextStage: 'investigate', headline: 'Wireframes v1 ready', questions: [QUESTIONS[0]] });
  const row = () => screen.getByRole('group', { name: 'The screens' });

  it('lists the screens from wireframes.json before the Screens tab has loaded the page; each chip opens the screens there', async () => {
    const get = vi.fn(async (path: string) => {
      if (path === '/api/job/alpha/doc?file=wireframes.json') return { file: 'wireframes.json', name: 'Wireframes data', type: 'json', html: '', text: WIREFRAMES_JSON };
      throw new Error(`unexpected ${path}`);
    });
    setup({ det: screensGate(), get, jobExtra: { wireframes: { version: '1' } } });
    const chips = await within(row()).findAllByRole('button', { name: /The list|Where the button goes/ });
    expect(chips.map((b) => b.textContent)).toEqual(['The list', 'Where the button goes']);
    expect(chips[1]).toHaveAttribute('title', expect.stringContaining('Design choice: Where the button goes'));
    expect(within(row()).getByRole('button', { name: 'Review the screens' })).toBeInTheDocument();
    // The questions (the picks, as the Foreman writes them) show as on any card.
    expect(screen.getByRole('group', { name: '1. Keep the old column?' })).toBeInTheDocument();
    // No Screens tab shows this job here (the Desk): the chip opens the full-width screens page.
    fireEvent.click(chips[0]);
    expect(window.location.hash).toBe('#/job/alpha/screens');
  });

  it('uses the page’s own report once it has posted: each chip says what you marked', async () => {
    const get = vi.fn(async () => { throw new Error('not asked'); });
    const unmount = mountFrame('alpha', () => null, () => {});
    act(() => {
      receive('alpha', { type: 'wireframes', version: '2', current: 's-list', screens: [
        { key: 'overview', name: 'What this adds', kind: 'overview', status: '', choice: '' },
        { key: 's-list', name: 'The list', kind: 'screen', status: 'fix', choice: '' },
        { key: 'c-entry', name: 'Where the button goes', kind: 'choice', status: '', choice: 'A' },
      ] });
    });
    setup({ det: screensGate(), get, jobExtra: { wireframes: { version: '2' } } });
    expect(row()).toHaveTextContent('Screens v2:');
    const chips = within(row()).getAllByRole('button', { name: /The list|Where the button goes/ });
    expect(chips.map((b) => b.textContent)).toEqual(['The list· Needs change', 'Where the button goes· Pick A']);
    expect(within(row()).queryByRole('button', { name: /What this adds/ }), 'the overview is not a screen').toBeNull();
    expect(get).not.toHaveBeenCalled();
    // A Screens tab shows the job: the chip stays on this page (the tab takes the request).
    fireEvent.click(chips[0]);
    expect(window.location.hash).toBe('');
    unmount();
  });

  it('shows no row on a wireframe gate when the job has no page yet, nor on other stages', () => {
    const { show } = setup({ det: screensGate(), get: vi.fn(async () => { throw new Error('not asked'); }) });
    expect(screen.queryByRole('group', { name: 'The screens' })).toBeNull();
    show(detail({ questions: [QUESTIONS[0]] }));
    expect(screen.queryByRole('group', { name: 'The screens' })).toBeNull();
  });
});

// Spec 1.2: the card's own buttons spin while their decision is out and can't send twice; the
// decision is shared with the job page's bar (gateSent.ts), sent only when it went to the Foreman.
describe('GateCard: a decision on its way', () => {
  beforeEach(disclosuresOpen);

  /** A POST to the gate that answers only when told to. */
  function held() {
    let answer: (v: unknown) => void = () => {};
    let refuse: (e: unknown) => void = () => {};
    const post = vi.fn((path: string, _body?: unknown): Promise<unknown> => (path.endsWith('/gate') ? new Promise((res, rej) => { answer = res; refuse = rej; }) : Promise.resolve({})));
    return { post, answer: (v: unknown = SENT) => act(async () => { answer(v); }), refuse: (e: unknown) => act(async () => { refuse(e); }) };
  }
  const gatePosts = (post: ReturnType<typeof vi.fn>) => post.mock.calls.filter(([p]) => p === '/api/job/alpha/gate');
  function Probe() { const s = useSent(gateSentKey('alpha')); return <output data-testid="sent">{s.state}</output>; }

  it('Approve spins on the click and cannot be pressed twice; the other calls rest meanwhile', async () => {
    const { post, answer } = held();
    setup({ det: oneQ(), post });
    const approve = button(/^Approve/);
    fireEvent.click(approve);
    fireEvent.click(approve);
    expect(approve).toHaveAttribute('aria-busy', 'true');
    expect(approve.querySelector('.spin-ring')).not.toBeNull();
    expect(button(/^Revise with feedback/)).toBeDisabled();
    expect(gatePosts(post)).toHaveLength(1);
    await answer();
    expect(approve).not.toHaveAttribute('aria-busy');
  });

  it('Send the reply spins on the click and cannot be pressed twice', async () => {
    const { post, answer } = held();
    setup({ det: oneQ(), post });
    fireEvent.click(button('Other guidance'));
    fireEvent.change(within(card()!).getByRole('textbox', { name: /Your answers or a note for the Foreman/ }), { target: { value: 'Is the CSV in scope?' } });
    const send = button('Send the reply');
    fireEvent.click(send);
    fireEvent.click(send);
    expect(send).toHaveAttribute('aria-busy', 'true');
    expect(gatePosts(post)).toHaveLength(1);
    await answer();
  });

  it('Stop the job spins on the click and cannot be pressed twice', async () => {
    const { post, answer } = held();
    setup({ det: oneQ(), post });
    fireEvent.click(button('More actions'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Stop job…' }));
    fireEvent.change(within(card()!).getByRole('textbox', { name: /Type the job’s name/ }), { target: { value: 'alpha' } });
    const stop = button('Stop the job');
    await act(async () => { fireEvent.click(stop); });
    fireEvent.click(stop);
    expect(stop).toHaveAttribute('aria-busy', 'true');
    expect(gatePosts(post)).toHaveLength(1);
    await answer();
  });

  it('a refusal stops the spinner, says why on the card, and the card can send again', async () => {
    const { post, refuse } = held();
    setup({ det: oneQ(), post });
    render(<Probe />);
    fireEvent.click(button(/^Approve/));
    expect(screen.getByTestId('sent')).toHaveTextContent('sending');
    await refuse(new ApiError(400, 'The reply is too long.'));
    expect(screen.getByTestId('sent')).toHaveTextContent('idle');
    expect(within(card()!).getByRole('alert')).toHaveTextContent('The reply is too long.');
    expect(button(/^Approve/)).toBeEnabled();
    expect(button(/^Approve/)).not.toHaveAttribute('aria-busy');
  });

  it('sent once it went to the Foreman; a reply held for the limit or given back is not; one queued by the website stays out', async () => {
    const outcomes: [unknown, string][] = [
      [SENT, 'sent'],
      [{ ok: true, sent: false, held: true, text: '', message: 'Held until Claude’s usage limit resets.' }, 'idle'],
      [{ ok: true, sent: false, queued: false, text: 'Approved.', message: 'still working' }, 'idle'],
      // Queued by the website: still out until the page shows the queued decision (its own test is in Hosted/Mirror).
      [{ ok: true, sent: false, held: true, queued: { id: 'd_1', state: 'waiting' }, text: '', message: 'Go: waiting for your laptop.' }, 'sending'],
    ];
    for (const [answer, state] of outcomes) {
      const post = vi.fn(async () => answer);
      const { unmount } = setup({ det: oneQ(), post });
      const probe = render(<Probe />);
      await act(async () => { fireEvent.click(button(/^Approve/)); });
      expect(screen.getByTestId('sent'), JSON.stringify(answer)).toHaveTextContent(state);
      unmount();
      probe.unmount();
      clearAllSent();
      clearGateSent();
      localStorage.clear();
      disclosuresOpen();
    }
  });
});

describe('the hand test under Auto', () => {
  const HAND_TEST_LINE = 'Auto skips your hand test on this job. The recorded evidence still runs.';

  it('an Auto job shows the hand test line in place of the ask', () => {
    setup({ det: detail({ stage: 'test' }), jobExtra: { auto: { on: true, ran: true } } });
    expect(screen.getByText(HAND_TEST_LINE)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try it on your computer' })).toBeNull();
  });

  it('a job without Auto keeps the Try it button', () => {
    setup({ det: detail({ stage: 'test' }) });
    expect(screen.getByRole('button', { name: 'Try it on your computer' })).toBeInTheDocument();
    expect(screen.queryByText(HAND_TEST_LINE)).toBeNull();
  });

  // Deep review D, I5: Auto stopped and asks him to decide, so his hand test is back.
  it('a stopped Auto job offers Try it on your computer, not the hand test line', () => {
    setup({ det: detail({ stage: 'test' }), jobExtra: { auto: { on: true, ran: true, stopped: { reason: 'a database change needs you.', rule: 'database', at: '2026-11-11T08:00:00.000Z' } } } });
    expect(screen.getByRole('button', { name: 'Try it on your computer' })).toBeInTheDocument();
    expect(screen.queryByText(HAND_TEST_LINE)).toBeNull();
  });
});

// On the website Try it and the Screens page are on the laptop: the card says so in one sentence.
describe('the gate card on the website', () => {
  const TRY_ON_LAPTOP = 'Try it runs on your laptop. Open the job there to use it.';
  const HAND_TEST_LINE = 'Auto skips your hand test on this job. The recorded evidence still runs.';

  it('at a test gate it says Try it is on the laptop, with no Try it button', () => {
    setup({ det: detail({ stage: 'test' }), hosted: true });
    expect(screen.getByText(TRY_ON_LAPTOP)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try it on your computer' })).toBeNull();
  });

  it('an Auto job there keeps the hand test line, and says nothing about Try it', () => {
    setup({ det: detail({ stage: 'test' }), hosted: true, jobExtra: { auto: { on: true, ran: true } } });
    expect(screen.getByText(HAND_TEST_LINE)).toBeInTheDocument();
    expect(screen.queryByText(TRY_ON_LAPTOP)).toBeNull();
  });

  it('at the screens gate it says the Screens page opens on the laptop, with no screens row', () => {
    const get = vi.fn(async () => { throw new Error('not asked'); });
    setup({ det: detail({ stage: 'wireframe', nextStage: 'investigate', questions: [QUESTIONS[0]] }), hosted: true, get, jobExtra: { wireframes: { version: '1' } } });
    expect(screen.getByText(ON_LAPTOP_LINE)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'The screens' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Review the screens' })).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  it('a screens gate with no page yet says nothing about the Screens page', () => {
    setup({ det: detail({ stage: 'wireframe', nextStage: 'investigate', questions: [QUESTIONS[0]] }), hosted: true, get: vi.fn(async () => { throw new Error('not asked'); }) });
    expect(screen.queryByText(ON_LAPTOP_LINE)).toBeNull();
  });
});

// ---------- Task 8 (design 3.3): questions first, the evidence in one line ----------

describe('GateCard: questions first, the evidence in one line', () => {
  beforeEach(disclosuresOpen);

  const PROOF = { tested: 'c3e8a51ff', head: 'c3e8a51ff', stale: false, reportAt: null };
  const testGate = (gate: Partial<Gate> = {}, extra: Partial<JobDetail> = {}) => detail({ stage: 'test', nextStage: 'review', nextProposed: 'Review', proof: PROOF, ...gate }, extra);
  const EVIDENCE_VIEW = {
    evidence: {
      version: 1, commit: 'c3e8a51ff', at: new Date(Date.now() - 40 * 60_000).toISOString(), level: 1,
      criteria: [{ id: 'AC-1', title: 'The column shows', status: 'passed', reason: null, spec: 'evidence/specs/AC-1.spec.mjs', screenshots: [], video: null }],
    },
    commit: 'c3e8a51ff', wanted: true, why: 'Evidence is recorded at L1.', recording: false, problem: null, folder: '/tmp/alpha/evidence', folderUrl: 'file:///tmp/alpha/evidence/',
  };
  const RECORDING = (line: number) => ({ ...EVIDENCE_VIEW, recording: true, progress: { commit: 'c3e8a51ff', startedAt: new Date().toISOString(), line, of: 19, lines: [] } });
  const evidenceGet = (view: () => unknown = () => EVIDENCE_VIEW) => vi.fn(async (path: string): Promise<unknown> => {
    if (path.endsWith('/evidence')) return view();
    if (path === '/api/job/alpha/doc?file=wireframes.json') return { file: 'wireframes.json', name: 'Wireframes data', type: 'json', html: '', text: JSON.stringify({ version: 1, screens: [{ key: 's-list', name: 'The list', states: [] }], choices: [] }) };
    return null;
  });
  /** Each part of the card, in the order the card must draw them. */
  const PARTS = ['.gate-head', '.gate-question', '.gate-off', '.gate-actions', '.gate-try', '.gate-evidence', '.gate-decided', '.sb-gate-auto-decided', '.gate-adjust', '.how'];
  const inOrder = (root: Element, selectors: string[]) => {
    const els = selectors.map((s) => root.querySelector(s));
    els.forEach((el, i) => expect(el, selectors[i]).not.toBeNull());
    for (let i = 1; i < els.length; i++) {
      expect(els[i - 1]!.compareDocumentPosition(els[i]!) & Node.DOCUMENT_POSITION_FOLLOWING, `${selectors[i - 1]} before ${selectors[i]}`).toBeTruthy();
    }
  };
  const AUTO = { on: true, tag: null, decided: ['Keep the old column? Yes', 'Brief 1 (plan): go ahead? Sent back.'] };

  it('the questions come before the evidence, the decisions and the extras', async () => {
    const { unmount } = setup({ det: testGate({}, { auto: AUTO }), get: evidenceGet() });
    await screen.findByRole('region', { name: /^Evidence: / });
    inOrder(card()!, PARTS);
    // An open box goes first, above the head.
    fireEvent.click(button('Revise with feedback'));
    inOrder(card()!, ['.gate-note', '.gate-head', '.gate-question']);
    unmount();
    // The screens row: after the calls, before the decisions.
    setup({ det: detail({ stage: 'wireframe', nextStage: 'investigate', questions: [QUESTIONS[0]] }), get: evidenceGet(), jobExtra: { wireframes: { version: '1' } } });
    await within(card()!).findByRole('button', { name: 'The list' });
    inOrder(card()!, ['.gate-head', '.gate-question', '.gate-actions', '.gate-screens', '.gate-decided', '.gate-adjust', '.how']);
  });

  it('the recommended answer is picked and says Picked; the last choice reads Your own answer', async () => {
    const { post } = setup();
    const q1 = screen.getByRole('group', { name: '1. Keep the old column?' });
    const yes = within(q1).getByRole('radio', { name: /a\) Yes/ });
    expect(yes).toBeChecked();
    expect(yes.closest('label')).toHaveTextContent('Recommended');
    expect(yes.closest('label')).toHaveTextContent('Picked');
    expect(within(q1).getByRole('radio', { name: /b\) No/ }).closest('label')).not.toHaveTextContent('Picked');
    expect(q1).not.toHaveTextContent('Other…');
    // The last choice: its box opens once it is picked.
    const own = within(q1).getByRole('radio', { name: 'Your own answer' });
    expect(within(q1).queryByRole('textbox')).toBeNull();
    fireEvent.pointerDown(own);
    fireEvent.click(own, { detail: 1 });
    expect(own).toBeChecked();
    expect(yes.closest('label'), 'Picked moves with the pick').not.toHaveTextContent('Picked');
    expect(own.closest('label')).toHaveTextContent('Picked');
    const box = within(q1).getByRole('textbox', { name: 'Your own answer to question 1' });
    expect(box).toHaveFocus();
    fireEvent.change(box, { target: { value: 'Only for admins' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Your answer to question 2' }), { target: { value: 'Copy ID' } });
    await act(async () => { fireEvent.click(button(/^Approve quick plan/)); });
    expect(post.mock.calls[0][1].answers).toEqual({ 1: { other: 'Only for admins' }, 2: { other: 'Copy ID' } });
  });

  it('a card on a job Auto ran on says how many decisions Auto made and lists them, each marked (Auto)', () => {
    const { show } = setup({ det: oneQ({}, { auto: AUTO }) });
    const fold = () => card()!.querySelector<HTMLDetailsElement>('.sb-gate-auto-decided');
    expect(fold()!.open).toBe(false);
    const summary = fold()!.querySelector('summary')!;
    expect(summary).toHaveTextContent('2 decisions made by Auto on this job so far');
    expect(summary).toHaveTextContent('Review');
    fireEvent.click(summary);
    expect(fold()!.open).toBe(true);
    expect(summary).toHaveTextContent('Hide');
    const list = within(card()!).getByRole('list', { name: 'Decided by Auto on this job' });
    expect([...list.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['Keep the old column? Yes (Auto)', 'Brief 1 (plan): go ahead? Sent back. (Auto)']);
    show(oneQ({}, { auto: { on: true, decided: ['Keep the old column? Yes'] } }));
    expect(fold()!.querySelector('summary')).toHaveTextContent('1 decision made by Auto on this job so far');
    // Nothing Auto decided to list, or a job (or an older Starbase) with no list: no line.
    show(oneQ({}, { auto: { on: true, decided: [] } }));
    expect(fold()).toBeNull();
    show(oneQ());
    expect(fold()).toBeNull();
  });

  it('what you typed in a box is still there after the job is fetched again', async () => {
    let line = 4;
    const { show } = setup({ det: testGate(), get: evidenceGet(() => RECORDING(line)) });
    await screen.findByRole('region', { name: 'Evidence: recording, line 4 of 19' });
    fireEvent.click(button('Revise with feedback'));
    fireEvent.change(within(card()!).getByRole('textbox', { name: /What should change\?/ }), { target: { value: 'Split step 2.' } });
    // The job fetched again: a new detail for the same brief, and the evidence moves on a line.
    line = 5;
    show(testGate());
    await screen.findByRole('region', { name: 'Evidence: recording, line 5 of 19' });
    expect(within(card()!).getByRole('textbox', { name: /What should change\?/ })).toHaveValue('Split step 2.');
    expect(button('Revise with feedback')).toHaveAttribute('aria-expanded', 'true');
    // The same for Reply's box.
    fireEvent.click(button('Other guidance'));
    fireEvent.change(within(card()!).getByRole('textbox', { name: /Your answers or a note/ }), { target: { value: 'Is the CSV in scope?' } });
    show(testGate({ waitingSince: new Date().toISOString() }));
    expect(within(card()!).getByRole('textbox', { name: /Your answers or a note/ })).toHaveValue('Is the CSV in scope?');
  });

  it('words typed in What should change? keep Go off and say so', () => {
    expect(CHANGES_TYPED).toBe('You wrote what should change. Send it back or cancel it first.');
    setup({ det: oneQ() });
    const approve = button(/^Approve quick plan/);
    expect(approve).toBeEnabled();
    fireEvent.click(button('Revise with feedback'));
    fireEvent.change(within(card()!).getByRole('textbox', { name: /What should change\?/ }), { target: { value: 'Split step 2.' } });
    expect(approve).toBeDisabled();
    expect(approve).toHaveAttribute('data-off-why', 'You wrote what should change. Send it back or cancel it first.');
    expect(offList()).toHaveTextContent('You wrote what should change. Send it back or cancel it first.');
    fireEvent.click(within(card()!).getByRole('button', { name: 'Cancel' }));
    expect(approve).toBeEnabled();
  });

  it('on the website the card has the same order and words', async () => {
    const store: Store = createStore();
    store.dispatch({ type: 'snapshot', snapshot: snapshot({ meta: { token: 't', levels: LEVELS, models: MODELS, jobOptions: { reviewers: REVIEWERS } }, jobs: [job('alpha', 'needs-you', { level: 1 })] }) });
    const api = { get: evidenceGet(), post: vi.fn(async () => SENT), hosted: () => true } as unknown as ApiClient;
    render(
      <WorkshopContext.Provider value={{ store, api }}>
        <UiProvider><GateSlot job={store.getState().jobs[0]} detail={testGate({}, { auto: AUTO })} now={new Date()} reload={vi.fn()} /></UiProvider>
      </WorkshopContext.Provider>,
    );
    await screen.findByRole('region', { name: /^Evidence: 1 passed, 0 failed$/ });
    // Try it is the laptop's: in its place one sentence says so, and the rest is in the same order.
    inOrder(card()!, PARTS);
    expect(card()!.querySelector('.gate-try')).toHaveTextContent('Try it runs on your laptop. Open the job there to use it.');
    expect(within(card()!).queryByRole('button', { name: 'Try it on your computer' })).toBeNull();
    expect(within(screen.getByRole('group', { name: '1. Keep the old column?' })).getByRole('radio', { name: 'Your own answer' })).toBeInTheDocument();
    expect(card()!.querySelector('.gate-decided summary')).toHaveTextContent('2 decisions made for you');
    expect(card()!.querySelector('.sb-gate-auto-decided summary')).toHaveTextContent('2 decisions made by Auto on this job so far');
    fireEvent.click(button('Revise with feedback'));
    const box = within(card()!).getByRole('textbox', { name: 'What should change? The Foreman stays at this step and revises; nothing is approved.' });
    expect(box).toHaveAttribute('placeholder', 'Say what should change…');
    inOrder(card()!, ['.gate-note', '.gate-head']);
    expect([...card()!.querySelectorAll('.gate-note button')].map((b) => b.textContent)).toEqual(['Cancel', 'Send back']);
  });
});

// Task 7 fix round 1: once he wrote to an Auto job while the step waited, the step is his: his hand test is back.
describe('the hand test on a step that is his', () => {
  it('an Auto job whose step is his offers Try it on your computer, not the hand test line', () => {
    setup({ det: detail({ stage: 'test' }), jobExtra: { auto: { on: true, ran: true, yours: true } } });
    expect(screen.getByRole('button', { name: 'Try it on your computer' })).toBeInTheDocument();
    expect(screen.queryByText('Auto skips your hand test on this job. The recorded evidence still runs.')).toBeNull();
  });
});

// ---------- Task 8, fix round 1: focus, where a send's problem shows, and the words ----------

describe('GateCard: focus and the box’s own problems', () => {
  beforeEach(disclosuresOpen);
  const q1 = () => screen.getByRole('group', { name: '1. Keep the old column?' });
  const ownBox = () => within(q1()).queryByRole('textbox', { name: 'Your own answer to question 1' });

  it('the own-answer box takes focus on a click, Space or Enter, never on an arrow key', () => {
    setup({ det: oneQ() });
    const own = within(q1()).getByRole('radio', { name: 'Your own answer' });
    const yes = within(q1()).getByRole('radio', { name: /a\) Yes/ });
    // Arrow keys: the browser moves focus to the choice and picks it; focus stays in the group.
    fireEvent.keyDown(yes, { key: 'ArrowDown' });
    own.focus();
    fireEvent.click(own);
    expect(own).toBeChecked();
    expect(ownBox()).not.toBeNull();
    expect(own).toHaveFocus();
    // A click.
    fireEvent.click(yes);
    expect(ownBox()).toBeNull();
    fireEvent.pointerDown(own);
    fireEvent.click(own, { detail: 1 });
    expect(ownBox()).toHaveFocus();
    // Space.
    fireEvent.click(yes);
    own.focus();
    fireEvent.keyDown(own, { key: ' ' });
    fireEvent.click(own);
    expect(ownBox()).toHaveFocus();
    // Enter picks it too.
    fireEvent.click(yes);
    own.focus();
    fireEvent.keyDown(own, { key: 'Enter' });
    expect(own).toBeChecked();
    expect(ownBox()).toHaveFocus();
  });

  it('Cancel gives focus back to what opened the box', () => {
    setup({ det: oneQ() });
    for (const [opener, box] of [['Revise with feedback', /What should change\?/], ['Other guidance', /Your answers or a note/]] as const) {
      const b = button(opener);
      b.focus();
      fireEvent.click(b);
      expect(within(card()!).getByRole('textbox', { name: box })).toHaveFocus();
      fireEvent.click(within(card()!.querySelector<HTMLElement>('.gate-note')!).getByRole('button', { name: 'Cancel' }));
      expect(within(card()!).queryByRole('textbox', { name: box })).toBeNull();
      expect(b).toHaveFocus();
    }
  });

  it('a refused send back says why beside the box, with the terminal check there too', async () => {
    const post = vi.fn(async () => { throw new ApiError(409, 'Claude Code is open in this repository in a terminal.', { code: 'terminal-open' }); });
    setup({ det: oneQ(), post });
    fireEvent.click(button('Revise with feedback'));
    fireEvent.change(within(card()!).getByRole('textbox', { name: /What should change\?/ }), { target: { value: 'Split step 2.' } });
    await act(async () => { fireEvent.click(button('Send back')); });
    const box = card()!.querySelector<HTMLElement>('.gate-note')!;
    expect(within(box).getByRole('alert')).toHaveTextContent('Claude Code is open in this repository in a terminal.');
    expect(within(box).getByRole('checkbox', { name: /None of the open terminals is this job’s Foreman/ })).toBeInTheDocument();
    // The box closed: they show under the calls, as before.
    fireEvent.click(within(box).getByRole('button', { name: 'Cancel' }));
    expect(card()!.querySelector('.gate-note')).toBeNull();
    expect(within(card()!).getByRole('alert')).toHaveTextContent('Claude Code is open in this repository in a terminal.');
  });

  it('the decisions and the help say step, in plain sentences with no dash', () => {
    setup({ det: oneQ() });
    const list = screen.getByRole('region', { name: 'Decided on your behalf' });
    const item = within(list).getByText('Reviewers: head inspector').closest('li')!;
    expect(item.querySelector('.gate-decision-text')).toHaveTextContent('Reviewers: head inspector. Why: L1 default (review)');
    expect(item.textContent).not.toMatch(/ — /);
    fireEvent.click(within(item).getByRole('button', { name: 'Override' }));
    expect(within(item).getByRole('button', { name: 'Undo override' })).toHaveAttribute('title', 'Keep the Foreman’s decision after all. Going ahead confirms it.');
    const help = card()!.querySelector('.how-body')!;
    expect(help).toHaveTextContent('the Foreman stays at this step');
    expect(help.textContent).not.toMatch(/this stage/);
    expect(button('Revise with feedback').getAttribute('title')).not.toMatch(/stage/);
  });
});

// ---------- Task 8, follow-up round: a pick made earlier never moves focus later; step, not stage ----------

describe('GateCard: focus stays where he types', () => {
  beforeEach(disclosuresOpen);

  it('pressing the picked own answer again, then typing elsewhere: every letter lands where he typed', () => {
    setup();
    const q1 = screen.getByRole('group', { name: '1. Keep the old column?' });
    const own = within(q1).getByRole('radio', { name: 'Your own answer' });
    // A mouse click picks it and opens its box.
    fireEvent.pointerDown(own);
    fireEvent.click(own, { detail: 1 });
    const box1 = within(q1).getByRole('textbox', { name: 'Your own answer to question 1' });
    expect(box1).toHaveFocus();
    // Pressed again, already picked: the box takes focus at once, and nothing is left to move it later.
    box1.blur();
    fireEvent.pointerDown(own);
    fireEvent.click(own, { detail: 1 });
    expect(box1).toHaveFocus();
    // Space on it again, and a press let go elsewhere: the same.
    own.focus();
    fireEvent.keyDown(own, { key: ' ' });
    fireEvent.pointerDown(own);
    // He types in question 2: each letter stays there.
    const box2 = screen.getByRole('textbox', { name: 'Your answer to question 2' });
    box2.focus();
    for (const typed of ['C', 'Co', 'Copy']) {
      fireEvent.change(box2, { target: { value: typed } });
      expect(box2).toHaveFocus();
    }
    expect(box2).toHaveValue('Copy');
    expect(box1).toHaveValue('');
    // And in Reply's box.
    fireEvent.click(button('Other guidance'));
    const reply = within(card()!).getByRole('textbox', { name: /Your answers or a note/ });
    for (const typed of ['I', 'Is']) {
      fireEvent.change(reply, { target: { value: typed } });
      expect(reply).toHaveFocus();
    }
    expect(box1).toHaveValue('');
  });

  it('says step, not stage, where he reads it', async () => {
    const post = vi.fn(async () => ({ ...SENT, summary: ['Level: L2 Standard (small flow)'] }));
    setup({ post, det: oneQ({ usage: 'Claude’s five-hour limit is at 85%: Build may pause part-way.' }) });
    expect(card()!.querySelector('.gate-usage')!.getAttribute('title')).not.toMatch(/stage/);
    await act(async () => { fireEvent.click(button(/^Approve quick plan/)); });
    expect(screen.getByRole('list', { name: 'How the job runs from the next step' })).toHaveTextContent('Level: L2 Standard (small flow)');
  });
});

// Fix round 1 (final review A): the words kept in the card's boxes.
describe('words kept in the card’s boxes', () => {
  const kept = (brief: number, words: string, extra: Record<string, unknown> = {}) => writeStored(gateBoxKey('alpha'), JSON.stringify({ gate: `#${brief}`, brief, mode: 'changes', notes: { changes: words, message: '' }, ...extra }));

  // M3: the mover reads the store when it runs, not the value it was drawn with.
  it('the mover appends the words once, even when it runs twice for one change', () => {
    kept(2, 'Use the small table.');
    writeStored(draftKey('alpha'), 'Earlier.');
    const j = job('alpha', 'needs-you');
    const d = detail(null);
    function Mover() { useKeptBoxWords(j, d); return null; }
    render(<><Mover /><Mover /></>);
    expect(localStorage.getItem(draftKey('alpha'))).toBe('Earlier.\n\nUse the small table.');
    expect(localStorage.getItem(gateBoxKey('alpha'))).toBeNull();
  });
});

// M4: kept words belong to one Foreman session and one brief.
describe('words kept for one session', () => {
  it('words kept in another Foreman session are not restored into the new brief with the same number', () => {
    writeStored(gateBoxKey('alpha'), JSON.stringify({ gate: '#2', session: 's1', brief: 2, mode: 'changes', notes: { changes: 'Old words.', message: '' } }));
    setup({ det: detail({}, { drive: { mode: 'workshop', model: 'claude-opus-5-5', sessionId: 's2' } }) });
    expect(card()).not.toBeNull();
    expect(screen.queryByRole('textbox', { name: /What should change\?/ })).toBeNull();
    // Left for the job page to move to the message box, never wiped here.
    expect(localStorage.getItem(gateBoxKey('alpha'))).toContain('Old words.');
  });
});

// M7: a kept slot is never overwritten.
describe('a kept slot holding another brief’s words', () => {
  it('words held for brief 2 are moved to the message box, not lost, when he types in brief 3’s card', () => {
    writeStored(gateBoxKey('alpha'), JSON.stringify({ gate: '#2', session: null, brief: 2, mode: 'changes', notes: { changes: 'Brief two words.', message: '' } }));
    writeStored(draftKey('alpha'), 'Earlier.');
    setup({ det: oneQ({ briefNumber: 3 }) });
    // Brief 3's card does not restore brief 2's words.
    expect(screen.queryByRole('textbox', { name: /What should change\?/ })).toBeNull();
    fireEvent.click(button(/^Revise with feedback/));
    fireEvent.change(screen.getByRole('textbox', { name: /What should change\?/ }), { target: { value: 'Brief three words.' } });
    expect(localStorage.getItem(draftKey('alpha'))).toBe('Earlier.\n\nBrief two words.');
    const slot = localStorage.getItem(gateBoxKey('alpha')) ?? '';
    expect(slot).toContain('Brief three words.');
    expect(slot).not.toContain('Brief two words.');
  });
});

// M8: with no level chip on the page (the phone), L↓ does not send him to one.
describe('L↑ and L↓ with no level chip on the page', () => {
  it('their titles say a level is needed, not "Pick a level first"', () => {
    setup({ det: detail({ level: null }), jobExtra: { level: null } });
    expect(button('Lower the level')).toHaveAttribute('title', 'L↑ and L↓ need a level.');
    expect(button('Raise the level')).toHaveAttribute('title', 'L↑ and L↓ need a level.');
  });
});
