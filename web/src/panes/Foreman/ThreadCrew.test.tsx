// The crew in the conversation (Play layer step 3): handoff and worker lines, the live row, the
// Foreman in the header and the reviewers on a review brief. Off must render exactly what phase 2
// rendered (the snapshot below was recorded before the crew came in); Subtle draws them still and
// small, Full animated; nothing play-related goes inside a gate card, a permission card or the
// composer. Invented jobs only.
import { act, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../../api/client';
import type { Gate, Job, JobDetail, PlayMode, ThreadItem } from '../../api/types';
import { createStore, WorkshopContext, type Store } from '../../state/store';
import { job, permission, snapshot } from '../../state/test-fixtures';
import { CREW_SIZE, crewSize } from '../../play/crewSizes';
import { ForemanPane } from './ForemanPane';

const NOW = new Date(Date.UTC(2026, 9, 15, 13, 0));
const at = (m: number) => new Date(Date.UTC(2026, 9, 15, 12, m)).toISOString();

const THREAD: ThreadItem[] = [
  { id: 'brief:briefs/1-investigate.md', kind: 'brief', at: at(1), number: 1, stage: 'investigate', file: 'briefs/1-investigate.md', headline: 'Investigation done', point: null },
  { id: 'auto:aaa', kind: 'auto', at: at(2), items: [
    { at: at(2), headline: 'Start a helper: feature-investigator', who: 'conductor', reason: 'Starting a workflow worker is routine.' },
    { at: at(3), headline: 'Read src/app.ts', who: 'feature-investigator', reason: 'Reading is routine.' },
    { at: at(4), headline: 'Run git status', who: 'conductor' },
  ] },
  { id: 'decision:bbb', kind: 'decision', at: at(5), text: 'You allowed: Start a helper: feature-planner' },
  { id: 'blocked:ccc', kind: 'blocked', at: at(6), by: 'auto', text: 'Auto mode blocked: Run curl', preview: 'curl example.com', reason: 'Downloads code.', who: 'feature-implementer' },
  { id: 'auto:ddd', kind: 'auto', at: at(7), items: [
    { at: at(7), headline: 'Start a helper: feature-review-errors', who: 'conductor' },
    { at: at(7), headline: 'Start a helper: feature-review-db', who: 'conductor' },
    { at: at(7), headline: 'Start a helper: general-purpose', who: 'conductor' },
  ] },
  { id: 'brief:briefs/2-review.md', kind: 'brief', at: at(20), number: 2, stage: 'review', file: 'briefs/2-review.md', headline: 'Review done', point: null },
];

const ACTIVITY = [
  { who: 'conductor', name: 'Foreman', state: 'running' },
  { who: 'feature-investigator', name: 'Sleuth', state: 'finished', startedAt: at(2), lastAt: at(4) },
  { who: 'feature-review-errors', name: 'Fuse', state: 'finished', startedAt: at(8), lastAt: at(15) },
  { who: 'feature-review-db', name: 'Mason', state: 'finished', startedAt: at(8), lastAt: at(16) },
  { who: 'feature-review-ui', name: 'Painter', state: 'finished', startedAt: at(30), lastAt: at(35) },
];

const QUESTIONS: Gate['questions'] = [{ id: '1', text: 'Fix R-1 now?', recommendation: 'a', options: [{ id: 'a', label: 'Yes' }, { id: 'b', label: 'No' }] }];
const GATE: Gate = {
  briefNumber: 2, briefFile: 'briefs/2-review.md', headline: 'Review done', stage: 'review', nextStage: 'pr1', nextProposed: 'Fix round',
  questions: QUESTIONS, decided: [], versions: { spec: null, artifacts: {} }, raisedVersions: { spec: null, artifacts: {} }, stale: false,
  waitingSince: at(20), runActive: true, parked: false, level: 2, suggestedLevel: null, levelReason: null, usage: null,
};
const RUN = { id: 'run-1', slug: 'alpha', status: 'running', startedAt: at(40), lastAction: 'Sending work to feature-tester: Run checks', lastText: 'Checking the work.' };

const ALPHA: Job = job('alpha', 'running', {
  repo: { name: 'sample-repo', branch: 'feat/sample' }, level: 2, working: true,
  nowDoing: [{ who: 'feature-tester', name: 'Tester', doing: 'Run checks', since: at(41) }],
});

const detail = (extra: Partial<JobDetail> = {}): JobDetail => ({
  slug: 'alpha', title: 'Job alpha', branch: 'feat/sample', run: RUN, thread: THREAD, threadMore: false, activity: ACTIVITY,
  gate: GATE, answeredBriefs: [], heldReply: null, level: 2, options: { level: 2 },
  statusForCompose: { questions: QUESTIONS, decidedOnYourBehalf: [], nextProposed: 'Fix round', spec: null, artifacts: [], brief: { number: 2 } },
  drive: { mode: 'workshop', model: 'claude-opus-5-5' },
  ...extra,
});

function setup({ mode, jobs = [ALPHA], det = detail(), usage }: { mode?: PlayMode; jobs?: Job[]; det?: JobDetail; usage?: Partial<ReturnType<typeof snapshot>['usage']> } = {}) {
  const routes: Record<string, unknown> = {
    '/api/job/alpha': det,
    '/api/job/alpha/doc?file=briefs%2F2-review.md': { file: 'briefs/2-review.md', name: 'Brief 2', html: '<p>Review done</p><p>Two findings.</p>' },
  };
  const get = vi.fn(async (path: string) => {
    if (routes[path] === undefined) throw new ApiError(404, 'Not there.');
    return routes[path];
  });
  const store: Store = createStore();
  const settings = mode ? { policy: 'hands-off' as const, play: { mode, questDone: 'first-pr' as const, sounds: false } } : undefined;
  const p = { ...permission('perm-1', 'alpha'), agentType: 'feature-implementer', plain: { headline: 'Run npm install' } };
  const snap = snapshot({ jobs, permissions: [p], meta: { token: 't', settings } });
  if (usage) snap.usage = { ...snap.usage, ...usage };
  store.dispatch({ type: 'snapshot', snapshot: snap });
  const api = { get, post: vi.fn() } as unknown as ApiClient;
  const utils = render(<WorkshopContext.Provider value={{ store, api }}><ForemanPane slug="alpha" /></WorkshopContext.Provider>);
  return { ...utils, store };
}

async function loaded() {
  await screen.findByText('Investigation done');
  await screen.findByText('Two findings.');
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); localStorage.clear(); });

describe('the crew in the conversation: Off', () => {
  it('renders exactly what phase 2 rendered (no crew, no new words)', async () => {
    const { container } = setup({ mode: 'off' });
    await loaded();
    // Full times in tooltips depend on the time zone; everything else must match to the character.
    // Never update this snapshot for Play: it is the phase-2 output, which Play mode Off must keep
    // exactly. Regenerated once, 2026-10-21 (light round 2), because the gate card itself changed for
    // every mode: one primary button with the other decisions as links, the chips folded under
    // "Adjust the next step", and the facts line no longer naming the default permission setting.
    expect(container.innerHTML.replace(/title="[A-Z][a-z]{2} \d{1,2}, \d{4}, [^"]*"/g, 'title="(full time)"')).toMatchInlineSnapshot(`"<main class="pane pane-foreman" data-pane="foreman" aria-label="Foreman"><div class="foreman-column"><header class="job-header"><div class="job-header-line"><span class="hue-dot" style="--job-hue: 107;" aria-hidden="true"></span><h2 class="pane-title job-title">Job alpha</h2><div class="level-menu"><button type="button" class="chip level-chip" aria-haspopup="dialog" aria-expanded="false" title="L2 Standard:  Up: L3 Large. Down: L1 Small. Click to change it.">L2 Standard</button></div><div class="job-menu"><button type="button" aria-haspopup="true" aria-expanded="false" title="More things you can do with this job. ⌘K lists them too." class="btn btn-quiet"><span class="btn-label">Job menu <svg class="icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6"></path></svg></span></button></div></div><p class="job-facts muted"><span class="status status-running" data-group="running" title="Jobs the Foreman or its crew are working on right now.">Running</span><span title="The repository this job works in.">sample-repo</span><span class="num" title="The git branch this job builds on.">feat/sample</span></p></header><details class="how"><summary title="Show a short explanation of what this is and how it works.">How this works</summary><div class="how-body"><p>This is your conversation with the job’s Foreman, the Claude session that plans the work and runs the crew. Its briefs, questions and permission requests appear here for you to answer.</p><p>A brief opens in full while it waits for you and folds to its headline once you’ve answered; click a headline to open it again. Steps the Foreman took by itself are folded into one “routine steps” line.</p><p>When the Foreman waits for your decision, a <strong>gate card</strong> sits above the message box: its questions, what it decided on your behalf, and buttons that say what they do (Approve, Edit then approve, Revise, Other guidance). Its own “How this works” explains it.</p><p>When it wants to do something that isn’t routine, a card appears at the foot of the conversation: <strong>Allow once</strong>, <strong>Allow for this reply</strong> (when offered), <strong>Deny…</strong> with a note, or <strong>Always allow…</strong>, which saves a narrow rule you check first (listed in Settings). Questions come as a short form.</p><p>Write to the Foreman in the box at the foot. <strong>Send…</strong> shows exactly what it will receive before it goes. While it’s replying the button becomes <strong>Steer</strong>: your message joins the reply in progress and shows <em>Queued</em>, <em>Delivered</em>, then <em>Acted on</em>. <strong>Stop</strong> ends the reply; the job then waits for you. Each job keeps its own unsent draft in this browser.</p><p>How much asks you depends on the job’s permission setting (job menu, or Settings for all jobs). In <strong>Auto mode</strong> Claude Code’s safety model decides most steps; anything it blocks shows as a dim ⊘ line. Merges and migrations always ask; pushes, pull requests and rm -rf ask too, unless in auto mode your go-ahead already covers them; org or force pushes are refused.</p><p>The <strong>level chip</strong> next to the title (L0 Tweak to L3 Large) says how much process the job gets; click it to see what runs and to change it. When the Foreman suggests a different level, or none is chosen yet, a level card in the conversation shows the rules’ and the Foreman’s suggestions side by side.</p><p>The <strong>Job menu</strong> marks the job done or dropped (nothing is deleted; <strong>Reopen</strong> brings it back), opens <strong>Notes and options</strong> (a drawer with the job’s notes for the Foreman and its options: level, stages, reviewers, testing, Fable, models), and sets its own permission setting. <strong>⌘K</strong> (Ctrl+K) lists the same actions and more; press <strong>?</strong> for the keys.</p></div></details><section class="thread" aria-label="Conversation" aria-busy="false"><article class="thread-item brief-card is-answered" aria-label="Brief #1 · Investigate"><header class="brief-head"><button type="button" class="brief-toggle" aria-expanded="false" aria-controls="brief-body-brief_briefs_1-investigate_md" title="Open the whole brief."><svg class="icon brief-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m9 18 6-6-6-6"></path></svg><span class="brief-label">Brief #1 · Investigate</span><span class="brief-state">Answered</span><time class="thread-time num" datetime="2026-10-15T12:01:00.000Z" title="(full time)">59m</time></button><p class="brief-headline">Investigation done</p></header><div id="brief-body-brief_briefs_1-investigate_md" class="brief-body" hidden=""></div></article><details class="thread-item auto-fold"><summary title="Steps the Foreman took without asking, because your settings count them as routine. Open to see each one."><span class="glyph" aria-hidden="true">✓</span> 3 routine steps done automatically<time class="thread-time num" datetime="2026-10-15T12:02:00.000Z" title="(full time)">58m</time></summary><ul class="auto-steps"><li><span>Start a helper: feature-investigator</span><span class="muted" title="Why this counted as routine."> · Starting a workflow worker is routine.</span></li><li><span>Read src/app.ts</span><span class="muted"> · feature-investigator</span><span class="muted" title="Why this counted as routine."> · Reading is routine.</span></li><li><span>Run git status</span></li></ul></details><p class="thread-item decision thread-line"><span class="glyph" aria-hidden="true">›</span> You allowed: Start a helper: feature-planner <time class="thread-time num" datetime="2026-10-15T12:05:00.000Z" title="(full time)">55m</time></p><p class="thread-item thread-line blocked-line by-auto" data-ask="blocked" title="Auto mode’s safety model refused this step by itself, so it never came to you. The Foreman was told and carries on without it."><span class="glyph" aria-hidden="true">⊘</span> Auto mode blocked: Run curl<span> · feature-implementer</span> · <code class="blocked-preview">curl example.com</code><span> · Downloads code.</span> <time class="thread-time num" datetime="2026-10-15T12:06:00.000Z" title="(full time)">54m</time></p><details class="thread-item auto-fold"><summary title="Steps the Foreman took without asking, because your settings count them as routine. Open to see each one."><span class="glyph" aria-hidden="true">✓</span> 3 routine steps done automatically<time class="thread-time num" datetime="2026-10-15T12:07:00.000Z" title="(full time)">53m</time></summary><ul class="auto-steps"><li><span>Start a helper: feature-review-errors</span></li><li><span>Start a helper: feature-review-db</span></li><li><span>Start a helper: general-purpose</span></li></ul></details><article class="thread-item brief-card" aria-label="Brief #2 · Review"><header class="brief-head"><button type="button" class="brief-toggle" aria-expanded="true" aria-controls="brief-body-brief_briefs_2-review_md" title="Fold this brief back to its headline."><svg class="icon brief-chevron is-down" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m9 18 6-6-6-6"></path></svg><span class="brief-label">Brief #2 · Review</span><time class="thread-time num" datetime="2026-10-15T12:20:00.000Z" title="(full time)">40m</time></button><p class="brief-headline">Review done</p></header><div id="brief-body-brief_briefs_2-review_md" class="brief-body"><div class="prose"><p>Two findings.</p></div><div class="kp-missing"><span class="muted">No short version of this brief yet.</span> <button type="button" class="link-button" title="Put a request for its key points into this job’s message box. Nothing is sent until you send it; the Foreman then writes them (a few cents).">Summarise</button></div></div></article><section class="pending-cards" aria-label="Waiting for you"><article class="thread-item perm-card" data-ask="permission" aria-label="Permission: Run npm install"><header class="perm-head"><p class="perm-who"><strong>feature-implementer</strong> wants to</p></header><h3 class="perm-headline">Run npm install</h3><div class="perm-actions"><button type="button" title="Let it do exactly this, one time. It asks again next time." class="btn btn-primary"><span class="btn-label">Allow once</span></button><button type="button" title="Say no. It skips this and carries on; you can tell it why." class="btn"><span class="btn-label">Deny…</span></button></div></article></section><section class="thread-item live-row" aria-label="Foreman, replying now"><header class="thread-meta"><span class="who">Foreman</span><span class="typing" aria-hidden="true"><span></span><span></span><span></span></span><span class="live-label" role="status">The Foreman is working</span></header><p class="live-action muted" title="The step the Foreman is on right now.">Sending work to feature-tester: Run checks</p><div class="live-text" title="The latest thing the Foreman wrote. The full reply appears here when it finishes."><span class="short-line">Checking the work.</span></div></section></section><section class="perm-card question-card gate-card" data-ask="question" aria-labelledby="_r_3_-head" aria-busy="false"><header class="gate-head"><p class="perm-who gate-meta"><span class="ask-label" title="The Foreman finished Review and waits for you before going on.">Brief 2 · Review</span><time class="thread-time" datetime="2026-10-15T12:20:00.000Z" title="Waiting for you since Oct 15, 2026, 5:20 AM.">waiting 40m</time></p><h3 class="perm-headline" id="_r_3_-head">Review done</h3><p class="muted gate-next" title="What the Foreman proposes to do once you approve.">Next, as proposed: Fix round</p><p class="muted gate-running" role="status">The Foreman is still working on a reply. Whatever you decide waits in the message box until it finishes.</p></header><p class="gate-try"><button type="button" title="Open the Try it tab: start this job’s app on your computer and click around before you decide." class="btn btn-quiet btn-sm"><svg class="icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m7 11 2-2-2-2"></path><path d="M11 13h4"></path><rect width="18" height="18" x="3" y="3" rx="2"></rect></svg><span class="btn-label">Try it on your computer</span></button></p><fieldset class="question gate-question"><legend>1. Fix R-1 now?</legend><label class="answer-option" title="The Foreman recommends this answer; it’s picked for you. Pick another to change it."><input class="choice" type="radio" value="a" checked="" name="_r_3_-q0"><span class="answer-label">a) Yes <span class="chip gate-rec">Recommended</span></span></label><label class="answer-option" title="Answer with this option."><input class="choice" type="radio" value="b" name="_r_3_-q0"><span class="answer-label">b) No</span></label><div class="answer-option answer-other"><label class="answer-other-pick" title="Answer in your own words instead."><input class="choice" type="radio" value="__other" name="_r_3_-q0"><span class="answer-label">Other…</span></label><input id="_r_3_-q0-other" class="text-input" aria-label="Your own answer to question 1" placeholder="Your own answer" title="Your answer in your own words. Typing here picks “Other…”." value=""></div></fieldset><div class="perm-actions gate-actions"><button type="button" data-gate="approve" title="Approve and start PR #1. Sends your answers, confirms the decisions you didn’t override, adds the chips’ lines, and says “At these versions”. The Foreman goes ahead with: Fix round." class="btn btn-primary"><span class="btn-label">Approve and start PR #1</span></button><span class="gate-links"><button type="button" class="link-button" title="See the whole reply exactly as the Foreman will receive it, edit it, then send it as your approval.">Edit, then approve</button><button type="button" class="link-button" data-gate="revise" aria-expanded="false" title="Ask for changes: the Foreman stays in this stage and revises. Nothing is approved.">Revise with feedback</button><button type="button" class="link-button" data-gate="guidance" aria-expanded="false" title="Tell the Foreman something else: a question or guidance. Nothing is approved.">Other guidance</button></span><div class="job-menu gate-more"><button type="button" aria-label="More actions" aria-haspopup="menu" aria-expanded="false" title="More: stop this job." class="btn btn-quiet"><span class="btn-label">⋯</span></button></div></div><details class="gate-adjust"><summary class="gate-fold" title="Change only the next step (or the level from the next step on): skip it, lighter, heavier, a Fable second look, do it yourself, L↑ or L↓. Each adds one line to your reply.">Adjust the next step (PR #1) </summary><div class="gate-chips" role="group" aria-label="Next step only (PR #1)"><button type="button" aria-label="Skip next (PR #1)" aria-pressed="false" aria-disabled="true" title="PR #1 is outside the build workflow; this chip is for spec to review." class="btn gate-chip"><span class="btn-label">Skip next</span></button><button type="button" aria-label="Lighter (PR #1)" aria-pressed="false" aria-disabled="true" title="PR #1 is outside the build workflow; this chip is for spec to review." class="btn gate-chip"><span class="btn-label">Lighter</span></button><button type="button" aria-label="Heavier (PR #1)" aria-pressed="false" aria-disabled="true" title="PR #1 is outside the build workflow; this chip is for spec to review." class="btn gate-chip"><span class="btn-label">Heavier</span></button><button type="button" aria-label="Ask Fable (the PR)" aria-pressed="false" title="Fable takes a short second look at the PR, the first point it can look at from PR #1 on: added to the job’s Fable points. It costs more than Opus." class="btn gate-chip"><span class="btn-label">Ask Fable</span></button><button type="button" aria-label="I’ll do this part (PR #1)" aria-pressed="false" aria-disabled="true" title="PR #1 is outside the build workflow; this chip is for spec to review." class="btn gate-chip"><span class="btn-label">I’ll do this part</span></button><button type="button" aria-label="Raise the level to L3" aria-pressed="false" title="Raise this job to L3 from the next stage." class="btn gate-chip"><span class="btn-label">L↑</span></button><button type="button" aria-label="Lower the level to L1" aria-pressed="false" title="Lower this job to L1 from the next stage. An approval still owed is still asked for." class="btn gate-chip"><span class="btn-label">L↓</span></button></div></details><details class="how"><summary title="Show a short explanation of what this is and how it works.">How this works</summary><div class="how-body"><p>The Foreman has briefed you and waits for your decision. Nothing goes ahead, and nothing is ever approved for you, until you press one of these.</p><p><strong>Approve</strong> (its label says what it approves and what starts) sends your answers to the questions, confirms the decisions made on your behalf that you didn’t override, and names the versions you approved. <strong>Edit, then approve</strong> shows that reply in full so you can change the words first. <strong>Revise with feedback</strong> asks for changes: the Foreman stays in this stage. <strong>Other guidance</strong> sends a question or a note without approving; the card stays open. Approve needs an answer to every question (a recommended answer is picked for you); while it is off, the card lists why, and the list empties as you resolve each point. <strong>Approve, start after reset</strong> appears when Claude’s usage limit is reached: your approval waits and goes when it resets. <strong>Stop job</strong> is under ⋯ and asks you to type the job’s name.</p><p><strong>Decisions made for you</strong> is folded to one line: open it to read each one, and <strong>Override</strong> marks one changed, with what it should be instead. <strong>Adjust the next step</strong> holds the chips, which change <strong>only the next step</strong>: skip it, make it lighter or heavier, ask Fable for a second look, do it yourself, or move the level up or down from there. Each adds one line to your reply, shown there exactly, and saves the job’s options where there is one.</p><p>If the plan changes after the card appears, it greys out (“Plan changed since this was proposed”) so you can’t approve an old version. If the Foreman is still working, your reply waits in the message box until it finishes. A decision left 4 hours shows as parked.</p></div></details></section><section class="composer" aria-label="Message the Foreman"><label for="_r_0_" class="sr-only">Steer the reply in progress</label><textarea id="_r_0_" data-composer-input="true" class="text-area composer-input" rows="3" placeholder="Add something to the reply in progress…" title="The Foreman is replying. What you write here joins that reply: it reads it at its next step. ⌘/Ctrl+Enter to steer."></textarea><div class="composer-bar"><label class="composer-model" title="The model for your next message. The reply in progress keeps the one it started with."><span class="muted">Foreman model</span><span class="select-box"><button type="button" role="combobox" class="select" aria-haspopup="listbox" aria-expanded="false" data-value="claude-opus-5-5" disabled=""><span class="select-value">claude-opus-5-5</span><svg class="icon select-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6"></path></svg></button></span></label><span class="composer-spacer"></span><button type="button" title="End the Foreman’s reply now. Anything waiting for your answer is declined, your draft is kept, and the job waits for your next message." class="btn btn-danger"><span class="btn-label">Stop</span></button><button type="button" disabled="" title="Add your message to the reply in progress. The Foreman reads it at its next step; its state shows on your message." class="btn btn-primary"><span class="btn-label">Steer</span></button></div></section></div></main>"`);
    expect(container.querySelector('.crew, .crew-tag, .crew-lineup, .live-crew')).toBeNull();
    expect(container).not.toHaveTextContent('started investigating');
    expect(container).toHaveTextContent('Start a helper: feature-investigator');
    expect(container).toHaveTextContent('· feature-implementer');
  });

  it('a usage pause adds nothing either', async () => {
    const paused = job('alpha', 'paused', { limitPaused: at(50) });
    const { container } = setup({ mode: 'off', jobs: [paused], det: detail({ run: null, gate: null }) });
    await screen.findByText('Investigation done');
    expect(container.querySelector('.crew, .live-row')).toBeNull();
  });
});

// Every size the crew are drawn at in Subtle: the first of a spot's pair, or its one size.
const SUBTLE_SIZES = Object.values(CREW_SIZE).map((v) => crewSize(v, false));

const crews = (el: ParentNode) => [...el.querySelectorAll<SVGSVGElement>('svg.crew')];

describe('the crew in the conversation: Subtle (the default)', () => {
  it('draws the crew still, at the Subtle sizes, each beside its name', async () => {
    const { container } = setup({ mode: 'subtle' });
    await loaded();
    const all = crews(container);
    expect(all.length).toBeGreaterThan(8);
    for (const svg of all) {
      expect(svg).toHaveClass('is-still');
      expect(SUBTLE_SIZES).toContain(Number(svg.getAttribute('width')));
      // Named: an image with an accessible name, or decoration next to words naming it.
      if (svg.getAttribute('aria-hidden') === 'true') {
        expect(svg.closest('.crew-tag, .crew-handoff, .live-crew')?.textContent?.trim().length, svg.className.baseVal).toBeGreaterThan(2);
      } else {
        expect(svg.getAttribute('aria-label')).toMatch(/^[A-Z]/);
      }
    }
    // The same is true with no Play setting at all: Subtle is the default.
  });

  it('shows the worker a routine step handed work to, and the worker that took a step', async () => {
    setup({ mode: 'subtle' });
    await loaded();
    const folds = document.querySelectorAll('details.auto-fold');
    const first = folds[0].querySelector('summary')!;
    expect(first).toHaveTextContent('3 routine steps done automatically');
    expect(first).toHaveTextContent('Sleuth started investigating');
    expect(first.querySelector('.crew-feature-investigator')).not.toBeNull();
    expect(folds[1].querySelector('summary')).toHaveTextContent('Fuse, Mason and general-purpose started work');
    // Inside the fold: the step that started Sleuth, and Sleuth's own step by name.
    const steps = folds[0].querySelectorAll('.auto-steps li');
    expect(steps[0]).toHaveTextContent('Start a helper: feature-investigator · Sleuth started investigating');
    expect(steps[1]).toHaveTextContent('Read src/app.ts · Sleuth');
    expect(steps[1]).not.toHaveTextContent('feature-investigator');
    // Characters inside a fold are drawn only once it is opened.
    expect(folds[0].querySelector('.auto-steps .crew')).toBeNull();
    act(() => {
      (folds[0] as HTMLDetailsElement).open = true;
      folds[0].dispatchEvent(new Event('toggle'));
    });
    expect(steps[0].querySelector('.crew-feature-investigator')).not.toBeNull();
    expect(steps[1].querySelector('.crew-feature-investigator')).not.toBeNull();
    expect(steps[1]).toHaveTextContent('Read src/app.ts · Sleuth');
    expect(steps[2].querySelector('.crew')).toBeNull();
    expect(folds[1].querySelector('.auto-steps .crew')).toBeNull(); // still closed
    // A refused step by the Builder.
    const refused = screen.getByText(/^Auto mode blocked/).closest('p')!;
    expect(refused).toHaveTextContent('Builder');
    expect(refused.querySelector('.crew-feature-implementer')).not.toBeNull();
    // A dispatch you allowed is your decision: no crew on it, nothing for approving.
    expect(screen.getByText(/You allowed: Start a helper/).closest('p')!.querySelector('.crew')).toBeNull();
  });

  it('lines up the reviewers who looked under a review brief, named on hover', async () => {
    setup({ mode: 'subtle' });
    await loaded();
    const lineup = screen.getByRole('list', { name: 'Reviewers on this round: Fuse and Mason' });
    const faces = within(lineup).getAllByRole('img');
    expect(faces.map((f) => f.getAttribute('aria-label'))).toEqual(['Fuse', 'Mason']);
    for (const f of faces) expect(Number(f.getAttribute('width'))).toBe(CREW_SIZE.lineup);
    expect(lineup.querySelector('li')).toHaveAttribute('title', 'Fuse: Review: errors and edge cases.');
    // Painter started after the brief: not on this round.
    expect(within(lineup).queryByRole('img', { name: 'Painter' })).toBeNull();
    // Only on review briefs.
    expect(screen.getAllByRole('list', { name: /Reviewers on this round/ })).toHaveLength(1);
  });

  it('the live row shows who is at work; the Foreman by the title shows the job’s mood', async () => {
    setup({ mode: 'subtle' });
    await loaded();
    const live = screen.getByRole('region', { name: 'Foreman, replying now' });
    expect(live).toHaveTextContent('Tester at work');
    expect(live.querySelector('.crew-feature-tester')).toHaveClass('is-working');
    expect(screen.getByRole('img', { name: 'Foreman, thinking' }).closest('.job-header')).not.toBeNull();
  });

  it('with no worker at work the live row shows the Foreman thinking; waiting when something waits for you', async () => {
    setup({ mode: 'subtle', jobs: [{ ...ALPHA, nowDoing: [] }] });
    await loaded();
    const live = screen.getByRole('region', { name: 'Foreman, replying now' });
    // Before its name the Foreman is decoration (the row names it once): drawn thinking, not announced twice.
    const lead = live.querySelector('.live-crew .crew-conductor')!;
    expect(lead).toHaveAttribute('data-state', 'thinking');
    expect(lead).toHaveAttribute('aria-hidden', 'true');
    expect(within(live).queryByRole('img', { name: /Foreman/ })).toBeNull();
    expect(within(live).getAllByText('Foreman')).toHaveLength(1);
  });

  it('the Foreman waits when the job needs you, and sleeps through a usage pause', async () => {
    const waiting = setup({ mode: 'subtle', jobs: [job('alpha', 'needs-you', { level: 2 })], det: detail({ run: { ...RUN, status: 'waiting_permission' } }) });
    await loaded();
    expect(screen.getAllByRole('img', { name: 'Foreman, waiting' })).toHaveLength(1); // the header; the live row's is decoration
    expect(screen.getByRole('region', { name: 'Foreman, replying now' }).querySelector('.crew-conductor')).toHaveAttribute('data-state', 'waiting');
    waiting.unmount();
    setup({ mode: 'subtle', jobs: [job('alpha', 'paused', { limitPaused: at(50) })], det: detail({ run: null, gate: null }) });
    await screen.findByText('Investigation done');
    expect(screen.getAllByRole('img', { name: 'Foreman, asleep' })).toHaveLength(2);
    expect(screen.getByText(/Asleep until Claude’s usage limit resets/)).toHaveClass('live-row', 'is-paused');
  });

  it('puts nothing play-related inside a gate card, a permission card or the composer', async () => {
    const { container } = setup({ mode: 'full' });
    await loaded();
    const cards = [...container.querySelectorAll('.gate-card, .perm-card, .composer')];
    expect(cards.length).toBeGreaterThanOrEqual(3);
    for (const c of cards) expect(c.querySelector('.crew, .crew-tag, .crew-lineup, .live-crew')).toBeNull();
  });

  it('explains the crew in How this works, only when Play is on', async () => {
    setup({ mode: 'subtle' });
    await loaded();
    expect(screen.getByText('crew', { selector: 'strong' }).closest('p')).toHaveTextContent('Settings → Play turns them off');
  });
});

describe('the crew in the conversation: Full', () => {
  it('moves (unless reduced motion is asked for)', async () => {
    const { container } = setup({ mode: 'full' });
    await loaded();
    const all = crews(container);
    expect(all.length).toBeGreaterThan(8);
    for (const svg of all) expect(svg).toHaveClass('is-animated');
    expect(screen.getByRole('img', { name: 'Foreman, thinking' })).toBeInTheDocument();
  });

  it('holds still with reduced motion', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }));
    try {
      const { container } = setup({ mode: 'full' });
      await loaded();
      for (const svg of crews(container)) expect(svg).toHaveClass('is-still');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
