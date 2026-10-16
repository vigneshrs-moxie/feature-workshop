import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../../api/client';
import type { Gate, GateResult, Job, JobDetail, Run } from '../../api/types';
import { gateDraftKey } from '../../lib/gateCard';
import { createStore, WorkshopContext, type Store } from '../../state/store';
import { job, LEVELS, REVIEWERS, snapshot } from '../../state/test-fixtures';
import { Composer, draftKey } from './Composer';
import { GateSlot } from './GateCard';

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

function setup({ det = detail(), post = vi.fn(async (): Promise<unknown> => SENT), jobExtra = {}, composer = false, limited = false, run = null }: {
  det?: JobDetail; post?: ReturnType<typeof vi.fn>; jobExtra?: Partial<Job>; composer?: boolean; limited?: boolean; run?: Run | null;
} = {}) {
  const store: Store = createStore();
  const usage = { limited, blocking: limited, label: limited ? 'five-hour limit' : null, resetsAt: limited ? '2026-10-16T15:42:00.000Z' : null };
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ meta: { token: 't', levels: LEVELS, models: MODELS, jobOptions: { reviewers: REVIEWERS } }, jobs: [job('alpha', 'needs-you', { level: 1, ...jobExtra })], usage }) });
  const api = { get: vi.fn(), post } as unknown as ApiClient;
  const reload = vi.fn();
  const view = (d: JobDetail) => (
    <WorkshopContext.Provider value={{ store, api }}>
      <GateSlot job={store.getState().jobs[0]} detail={d} now={new Date()} reload={reload} />
      {composer && <Composer slug="alpha" detail={d} run={run} />}
    </WorkshopContext.Provider>
  );
  const utils = render(view(det));
  return { ...utils, post, reload, store, show: (d: JobDetail) => utils.rerender(view(d)) };
}

const card = () => screen.queryByRole('region', { name: /Plan v2 ready|your reply is in the message box/ });
const button = (name: string | RegExp) => within(card()!).getByRole('button', { name });

afterEach(() => { localStorage.clear(); });

describe('GateCard', () => {
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

  it('never shows on a job marked done', () => {
    setup({ jobExtra: { closed: { as: 'done' } } });
    expect(card()).toBeNull();
  });

  it('has the brief, stage, waiting time, next step and a parked chip (in words)', () => {
    const { show } = setup();
    const c = card()!;
    expect(within(c).getByRole('heading', { level: 3 })).toHaveTextContent('Plan v2 ready');
    expect(c).toHaveTextContent('Brief 2 · Plan');
    expect(c).toHaveTextContent('waiting 2h');
    expect(c).toHaveTextContent('Next, as proposed: Build step 1');
    expect(within(c).queryByText('parked 4h')).toBeNull();
    show(detail({ parked: true, usage: 'Claude’s five-hour limit is at 85%: Build may pause part-way.' }));
    expect(within(card()!).getByText('parked 4h')).toHaveAttribute('title', expect.stringContaining('more than 4 hours'));
    expect(card()).toHaveTextContent('Claude’s five-hour limit is at 85%');
  });

  it('picks the recommendation, labelled Recommended; questions are labelled radio groups with Other…', () => {
    setup();
    const q1 = screen.getByRole('group', { name: '1. Keep the old column?' });
    expect(within(q1).getByRole('radio', { name: /a\) Yes/ })).toBeChecked();
    expect(within(q1).getByRole('radio', { name: /a\) Yes/ }).closest('label')).toHaveTextContent('Recommended');
    expect(within(q1).getByRole('radio', { name: /b\) No/ })).not.toBeChecked();
    expect(within(q1).getByRole('radio', { name: 'Other…' })).not.toBeChecked();
    const q2 = screen.getByRole('group', { name: '2. What should the button say?' });
    expect(within(q2).queryByRole('radio')).toBeNull();
    expect(within(q2).getByRole('textbox', { name: 'Your answer to question 2' })).toBeInTheDocument();
  });

  it('names what Approve does, from the versions and the next stage', () => {
    const { show } = setup();
    expect(button('Approve quick plan v2 and start Build')).toHaveAttribute('title', expect.stringContaining('The Foreman goes ahead with: Build step 1.'));
    show(detail({ versions: null, raisedVersions: null, nextStage: null }));
    expect(button('Approve and go ahead')).toBeInTheDocument();
    show(detail({ stage: 'spec', nextStage: 'refine', versions: { spec: '0.3', artifacts: {} }, raisedVersions: { spec: '0.3', artifacts: {} } }));
    expect(button('Approve spec v0.3 and start Refine')).toBeInTheDocument();
    show(detail({ versions: { spec: null, artifacts: { 'implementation-plan': '3', Findings: '1' } }, raisedVersions: { spec: null, artifacts: { 'implementation-plan': '2', Findings: '1' } } }));
    expect(button('Approve plan v2 and start Build'), 'the version it was raised at').toBeInTheDocument();
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

  it('Override flips a decision to changed with your note; an empty one is asked for first', async () => {
    const { post } = setup({ det: oneQ() });
    const list = screen.getByRole('region', { name: 'Also decided on your behalf' });
    expect(within(list).queryByText('Already settled')).toBeNull(); // confirmed ones aren't listed again
    const item = within(list).getByText('Toast text is “Copied”').closest('li')!;
    fireEvent.click(within(item).getByRole('button', { name: 'Override' }));
    expect(item).toHaveTextContent('Changed');
    await act(async () => { fireEvent.click(button(/^Approve quick plan/)); });
    expect(post).not.toHaveBeenCalled();
    expect(within(card()!).getByRole('alert')).toHaveTextContent('Say what “Toast text is “Copied”” should be instead, or undo that override.');
    fireEvent.change(within(item).getByRole('textbox', { name: 'What should it be instead?' }), { target: { value: 'Say “Copied to clipboard”' } });
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

  it('Approve with a question left unanswered is stopped inline, naming the question', async () => {
    const { post } = setup();
    // Question 1 has its recommendation picked; question 2 has no options and nothing written.
    await act(async () => { fireEvent.click(button(/^Approve quick plan/)); });
    expect(post).not.toHaveBeenCalled();
    expect(within(card()!).getByRole('alert')).toHaveTextContent('Question 2 has no answer.');
    fireEvent.click(button('Edit, then approve'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(card()!).getByRole('alert')).toHaveTextContent('Question 2 has no answer.');
    // "Other…" picked on question 1 with nothing written: no answer either.
    fireEvent.change(screen.getByRole('textbox', { name: 'Your answer to question 2' }), { target: { value: 'Copy ID' } });
    fireEvent.click(within(screen.getByRole('group', { name: '1. Keep the old column?' })).getByRole('radio', { name: 'Other…' }));
    await act(async () => { fireEvent.click(button(/^Approve quick plan/)); });
    expect(within(card()!).getByRole('alert')).toHaveTextContent('Question 1 has no answer.');
    fireEvent.click(within(screen.getByRole('group', { name: '1. Keep the old column?' })).getByRole('radio', { name: /a\) Yes/ }));
    await act(async () => { fireEvent.click(button(/^Approve quick plan/)); });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][1].answers).toEqual({ 1: { choice: 'a' }, 2: { other: 'Copy ID' } });
  });

  it('with no level, L↑ and L↓ are off and point to the level chip', () => {
    setup({ det: detail({ level: null }), jobExtra: { level: null } });
    expect(button('Raise the level')).toHaveAttribute('aria-disabled', 'true');
    expect(button('Lower the level')).toHaveAttribute('title', 'Pick a level first: this job has none yet.');
    expect(button('Pick a level first')).toBeInTheDocument();
  });

  it('greys out when the plan changed since it was proposed: approvals off, the rest still work', async () => {
    const { post, reload } = setup({ det: detail({ stale: true }), limited: true });
    const c = card()!;
    expect(c).toHaveClass('is-stale');
    expect(c).toHaveTextContent('Plan changed since this was proposed');
    expect(button(/^Approve quick plan/)).toBeDisabled();
    expect(button('Edit, then approve')).toBeDisabled();
    expect(button('Approve, start after reset')).toBeDisabled();
    expect(button('Revise with feedback')).toBeEnabled();
    expect(button('Other guidance')).toBeEnabled();
    expect(button('More actions')).toBeEnabled();
    fireEvent.click(button('Check again'));
    expect(reload).toHaveBeenCalledTimes(1);
    fireEvent.click(button('Revise with feedback'));
    const send = button('Send the changes');
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
    expect(within(note).getByRole('list', { name: 'How the job runs from the next stage' })).toHaveTextContent('Level: L2 Standard (small flow)');
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

  it('Other guidance needs a note and sends it as a message', async () => {
    const { post } = setup();
    fireEvent.click(button('Other guidance'));
    expect(button('Send the guidance')).toBeDisabled();
    fireEvent.change(within(card()!).getByRole('textbox', { name: /Your guidance or question/ }), { target: { value: 'Is the CSV in scope?' } });
    await act(async () => { fireEvent.click(button('Send the guidance')); });
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
    fireEvent.change(within(card()!).getByRole('textbox', { name: /Your guidance or question/ }), { target: { value: 'Also check the CSV.' } });
    await act(async () => { fireEvent.click(button('Send the guidance')); });
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
    expect(post).toHaveBeenLastCalledWith('/api/job/alpha/send', { kind: 'message', text, model: 'claude-opus-5-5', confirmNoTerminal: false, gateBrief: 2 });
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
    await act(async () => { fireEvent.click(button('Send the changes')); });
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
    expect(post).toHaveBeenCalledWith('/api/job/alpha/send', { kind: 'message', text: 'Something else.', model: 'claude-opus-5-5', confirmNoTerminal: false });
  });

  it('a gate reply in the box goes with its kind and brief', async () => {
    localStorage.setItem(draftKey('alpha'), 'I approve. Go ahead.');
    localStorage.setItem(gateDraftKey('alpha'), JSON.stringify({ brief: 2, kind: 'approve' }));
    const post = vi.fn(async () => ({}));
    setup({ post, det: detail(null), composer: true });
    fireEvent.click(screen.getByRole('button', { name: 'Send…' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send to the Foreman' })); });
    expect(post).toHaveBeenCalledWith('/api/job/alpha/send', { kind: 'approve', text: 'I approve. Go ahead.', model: 'claude-opus-5-5', confirmNoTerminal: false, gateBrief: 2 });
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
