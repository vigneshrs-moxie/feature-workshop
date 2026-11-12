// The new job page on a phone (Part 3, design 3.4, note 12): four simple screens, one column each,
// chosen by the address. Not the laptop page squeezed.
//   The job (#/job/<slug>): back to Jobs and the gear; the title, the state in a word and the ticket;
//     who started it; the bar with its card; the seven steps as rows; Overview, Copy decisions, What
//     Auto decided (once Auto has decided) and the Auto switch; Conversation fixed at the bottom with
//     how many messages are new.
//   A step (#/job/<slug>/stage/<step>): back to the job by its title; the step's name, state and time;
//     the step's own panel and body, as on a laptop. The screen of the step that waits for you
//     carries the bar and its three calls first, the card folded to one row (the owner's requirement).
//   The conversation (#/job/<slug>/conversation): the conversation panel, full screen.
//   The overview (#/job/<slug>/overview): the ticket, what we're building and what to check, open.
// Each row goes by `navigate` (a new history entry), so Back returns to the job. The head scrolls
// with the screen.
//
// The bar's three calls are NextStep's own buttons, placed by page.css (Send back and Reply side by
// side, Go under them). The caller gives the one conversation and the one sent line (useSentShown),
// so the state chip, every step row and the step's panel say the same; the evidence is asked once
// here (useJobEvidence) for the bar's card and the Test step. On the website there is no gear: one
// sentence says the menu is on the laptop.
import { useEffect, useId, useRef, type ReactNode } from 'react';
import type { Job, JobDetail, JobPageFacts, StageAgent, StopId } from '../../api/types';
import { navigate, type JobView } from '../../app/router';
import { useUi } from '../../app/ui';
import { Button } from '../../components/Button';
import { Chip } from '../../components/Chip';
import { Icon } from '../../components/Icon';
import { STOPS, stopOf } from '../../components/stops/stops';
import { LANE_INFO, laneOf } from '../../home/JobsPage';
import type { GateKind } from '../../lib/compose';
import { readStored } from '../../lib/stored';
import { JobMenu } from '../../panes/Foreman/JobHeader';
import type { useJobConversation } from '../../panes/Foreman/ForemanPane';
import { DecisionsTab } from '../../panes/Preview/DecisionsTab';
import { useWorkshop, useWorkshopState } from '../../state/store';
import { AutoSwitch } from '../AutoSwitch';
import { CopyDecisions } from '../CopyDecisions';
import { NextStep, ticketOf } from '../NextStep';
import { WhatAutoDecided } from '../WhatAutoDecided';
import { ConversationPanel, newCount, seenKey } from './ConversationPanel';
import { AUTO_START_WHERE, headerState, MENU_ON_LAPTOP } from './JobTop';
import { BUILDING_NOT_WRITTEN, NO_TICKET } from './OverviewCard';
import { StepBody } from './StepBody';
import { StepPanel } from './StepPanel';
import { statesOf, stepState, stepTimeWords } from './stepWords';
import { recorderAgent } from './TestStep';
import { useJobEvidence, type JobEvidence } from './useJobEvidence';
import { useStage } from './useStage';
import { WhatToCheck } from './WhatToCheck';
import './page.css';

type Conversation = ReturnType<typeof useJobConversation>;
type Sent = { kind: GateKind | null } | null;

interface ScreenProps { job: Job; conversation: Conversation; now: Date; sent: Sent; evidence: JobEvidence }

/**
 * The step that waits for you: the gate's step while a gate waits (so an Auto job that is deciding has
 * one too), else the step the job waits at (a permission, a question). Null when nothing waits.
 */
function waitingStep(job: Job, detail: JobDetail | null): StopId | null {
  const gate = detail?.gate;
  if (gate) return stopOf(gate.stage) ?? stopOf(job.stage);
  const states = statesOf(job);
  return STOPS.find((s) => states[s.id] === 'waiting')?.id ?? null;
}

export function PhoneJob({ job, conversation, now, step, view, sent }: { job: Job; conversation: Conversation; now: Date; step?: StopId; view?: JobView; sent: Sent }) {
  const slug = job.slug;
  const ui = useUi();
  const evidence = useJobEvidence(job);
  const { setTryOpen } = evidence;
  // The job menu's "Try it on your computer": the Test step's screen, with Try it open.
  const handledTry = useRef(ui.tryRequest);
  useEffect(() => {
    if (ui.tryRequest === handledTry.current) return;
    handledTry.current = ui.tryRequest;
    if (ui.trySlug === slug) { navigate({ name: 'stage', slug, stop: 'test' }); setTryOpen(true); }
  }, [ui.tryRequest, ui.trySlug, slug, setTryOpen]);
  // "Review the screens": the full-width Screens page.
  const handledScreens = useRef(ui.screensRequest);
  useEffect(() => {
    if (ui.screensRequest === handledScreens.current) return;
    handledScreens.current = ui.screensRequest;
    if (ui.screensSlug === slug) navigate({ name: 'screens', slug });
  }, [ui.screensRequest, ui.screensSlug, slug]);

  const props: ScreenProps = { job, conversation, now, sent, evidence };
  const which = step ? 'step' : view ?? 'job';
  return (
    <main className={`page sb-phone is-${which}`} aria-label="Job">
      {step ? <StepScreen {...props} stop={step} />
        : view === 'conversation' ? <ConversationScreen {...props} />
        : view === 'overview' ? <OverviewScreen job={job} detail={conversation.thread.detail ?? null} />
        : <JobScreen {...props} />}
    </main>
  );
}

/** The back row: a chevron and where it goes. */
function Back({ to, children }: { to: () => void; children: ReactNode }) {
  return (
    <button type="button" className="sb-phone-back" onClick={to}>
      <Icon name="chevron-left" size={18} />
      <span className="sb-phone-back-words">{children}</span>
    </button>
  );
}

const toJob = (slug: string) => () => navigate({ name: 'job', slug });

// ---------- The job ----------

function JobScreen({ job, conversation, now, sent, evidence }: ScreenProps) {
  const slug = job.slug;
  const state = useWorkshopState();
  const { api } = useWorkshop();
  const hosted = Boolean(api.hosted?.());
  const { thread, run } = conversation;
  const detail = thread.detail ?? null;
  const lane = laneOf(job);
  const chip = headerState(job, state.permissions, sent);
  const ticket = ticketOf(job) ?? (typeof detail?.page?.ticket?.key === 'string' ? detail.page.ticket.key : null);
  // As the laptop's header: the job's record says a tag started Auto; the tag's name comes with the job's detail.
  const tag = typeof detail?.auto?.tag === 'string' && detail.auto.tag.trim() ? detail.auto.tag.trim() : null;
  const byTag = job.auto?.by === 'tag';
  const times = detail?.page?.times;
  const fresh = newCount(thread.items, readStored(seenKey(slug)));
  const overviewTicket = ticketFor(job, detail?.page);
  const stepsId = useId();
  return (
    <>
      <div className="sb-phone-scroll">
        <header className="sb-phone-head">
          <div className="sb-phone-nav">
            <Back to={() => navigate({ name: 'home' })}>Jobs</Back>
            <span className="sb-phone-spacer" />
            {hosted
              ? <span className="sb-phone-laptop">{MENU_ON_LAPTOP}</span>
              : <JobMenu job={job} dir={detail?.dir} policyOverride={detail?.policyOverride} run={run} worktree={detail?.worktree} started={Boolean(detail?.drive?.sessionId)} gear />}
          </div>
          <h1 className="sb-phone-title">{job.title || slug}</h1>
          <div className="sb-phone-facts">
            <Chip tone={chip.tone} icon={chip.icon} className={`state-chip is-${lane}`} title={sent ? undefined : LANE_INFO[lane].hint}>{chip.word}</Chip>
            {ticket && <span className="num">{ticket}</span>}
          </div>
          {byTag && <p className="sb-phone-by" title={AUTO_START_WHERE}><Icon name="bot" size={13} />{tag ? `Started by Auto · tag ${tag}` : 'Started by Auto'}</p>}
        </header>
        <div className="sb-phone-body">
          <NextStep
            job={job}
            conversation={conversation}
            now={now}
            onShip={() => navigate({ name: 'stage', slug, stop: 'ship' })}
            onWatch={() => { navigate({ name: 'stage', slug, stop: 'test' }); evidence.setWatching(true); }}
            evidence={evidence.view}
          />
        </div>
        <section className="sb-phone-section" aria-labelledby={stepsId}>
          <h2 className="eyebrow sb-phone-eyebrow" id={stepsId}>Steps</h2>
          <ul className="sb-phone-list">
            {STOPS.map((s) => {
              const st = stepState(job, s.id, sent);
              const time = stepTimeWords(job, s.id, times?.[s.id], now, null, sent);
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    className={`sb-phone-row ${st.cls}`.trim()}
                    aria-label={`${s.label}: ${st.words}${time ? `, ${time}` : ''}`}
                    onClick={() => navigate({ name: 'stage', slug, stop: s.id })}
                  >
                    <span className="sb-phone-row-icon" aria-hidden="true"><Icon name={s.icon} size={16} /></span>
                    <span className="sb-phone-row-words">
                      <span className="sb-phone-row-name">{s.label}</span>
                      <span className="sb-phone-row-note">{st.words}{time && ` · ${time}`}</span>
                    </span>
                    <Icon name="chevron-right" size={18} className="sb-phone-row-go" />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
        <div className="sb-phone-section sb-phone-list">
          <button type="button" className="sb-phone-row" onClick={() => navigate({ name: 'job', slug, view: 'overview' })}>
            <span className="sb-phone-row-icon" aria-hidden="true"><Icon name="file" size={16} /></span>
            <span className="sb-phone-row-words">
              <span className="sb-phone-row-name">Overview</span>
              <span className="sb-phone-row-note">{overviewNote(overviewTicket)}</span>
            </span>
            <Icon name="chevron-right" size={18} className="sb-phone-row-go" />
          </button>
          <div className="sb-phone-tool">
            <CopyDecisions slug={slug} all={<DecisionsTab slug={slug} active copy={false} />} />
            <span className="sb-phone-tool-note">The product decisions, ready for an Orbit comment</span>
          </div>
          {job.auto?.ran && (
            <div className="sb-phone-tool">
              <WhatAutoDecided slug={slug} auto={job.auto} plain />
              <span className="sb-phone-tool-note">Newest first</span>
            </div>
          )}
          <div className="sb-phone-auto">
            <AutoSwitch job={job} word tagLine={false} />
          </div>
        </div>
      </div>
      <div className="sb-phone-foot">
        <Button size="lg" icon="message" onClick={() => navigate({ name: 'job', slug, view: 'conversation' })}>
          Conversation{fresh > 0 && <>{' '}<Chip tone="accent">{fresh} new</Chip></>}
        </Button>
      </div>
    </>
  );
}

// ---------- A step ----------

function StepScreen({ job, conversation, now, sent, evidence, stop }: ScreenProps & { stop: StopId }) {
  const slug = job.slug;
  const detail = conversation.thread.detail ?? null;
  const here = STOPS.find((s) => s.id === stop) ?? STOPS[0];
  // The step's view: never another step's facts under this step's name; its body only once it is in.
  const stage = useStage(slug, stop);
  const view = stage.view && (!stage.view.stop || stage.view.stop === stop) ? stage.view : null;
  const state = stepState(job, stop, sent);
  const time = stepTimeWords(job, stop, view?.time, now, view?.since, sent);
  const waits = waitingStep(job, detail) === stop;
  const recorder = stop === 'test' ? recorderAgent(evidence.recording ? evidence.view?.progress : null) : null;
  return (
    <div className="sb-phone-scroll">
      <header className="sb-phone-head">
        <div className="sb-phone-nav"><Back to={toJob(slug)}>{job.title || slug}</Back></div>
        <h1 className="sb-phone-title"><Icon name={here.icon} size={20} />{here.label}</h1>
        <div className="sb-phone-facts">
          <span className={`chip sb-step-chip ${state.cls}`.trim()}>{state.words}</span>
          {time && <span className="num">{time}</span>}
        </div>
      </header>
      <div className="sb-phone-body">
        {waits && (
          <NextStep
            job={job}
            conversation={conversation}
            now={now}
            onShip={() => navigate({ name: 'stage', slug, stop: 'ship' })}
            onWatch={() => { navigate({ name: 'stage', slug, stop: 'test' }); evidence.setWatching(true); }}
            foldCard
            evidence={evidence.view}
          />
        )}
        <StepPanel
          job={job}
          stop={stop}
          view={view}
          error={stage.error}
          onRetry={stage.reload}
          now={now}
          extraAgents={[recorder].filter((a): a is StageAgent => a !== null)}
          sent={sent}
          bodyFirst={stop === 'test'}
        >
          {view && (
            <StepBody
              stop={stop} job={job} detail={detail} view={view} now={now}
              evidence={evidence.view} onRecorded={evidence.reload}
              watching={evidence.watching} onWatching={evidence.setWatching} tryOpen={evidence.tryOpen} onTryOpen={evidence.setTryOpen}
            />
          )}
        </StepPanel>
      </div>
    </div>
  );
}

// ---------- The conversation ----------

function ConversationScreen({ job, conversation, now }: ScreenProps) {
  return (
    <>
      <div className="sb-phone-head is-bar">
        <div className="sb-phone-nav"><Back to={toJob(job.slug)}>{job.title || job.slug}</Back></div>
      </div>
      <div className="sb-phone-convo">
        <ConversationPanel job={job} conversation={conversation} now={now} wide={false} onWide={() => {}} full />
      </div>
    </>
  );
}

// ---------- The overview ----------
// The overview card's three parts (OverviewCard.tsx), open and one under another under their own
// headings, as drawn. The card draws them inside its fold and does not export them, so the ticket
// and what we're building are drawn here the same way, with the card's own sentences and classes.

type Ticket = NonNullable<JobPageFacts['ticket']>;
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

/** The ticket from the page facts, else the job's own ticket number (an older laptop): null when none. */
function ticketFor(job: Job, page: JobPageFacts | undefined): Ticket | null {
  const t = page?.ticket;
  if (t && text(t.key)) return t;
  const key = ticketOf(job);
  return key && text(key) ? { key } : null;
}

/** The overview row's note: the overview card's own. */
const overviewNote = (ticket: Ticket | null) => (ticket ? `${ticket.key} as written, what we’re building, what to check` : 'What we’re building, what to check');

/** "Nov 3", or null when the time can't be read. */
function day(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** "ORBIT-900 · filed by Dana Whitfield on Nov 3", with what is not known left out. */
function filedLine(t: Ticket): string {
  const by = text(t.filedBy);
  const on = day(t.filedAt);
  if (!by && !on) return t.key ?? '';
  return `${t.key} · filed${by ? ` by ${by}` : ''}${on ? ` on ${on}` : ''}`;
}

/** The description as plain paragraphs (a blank line between them); always text, never HTML. */
const paragraphs = (description: string | null | undefined) =>
  (description ?? '').split(/\n[ \t]*\n/).map((p) => p.replace(/^\n+|\n+$/g, '')).filter((p) => p.trim());

function Part({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="sb-ov-col" aria-labelledby={id}>
      <h2 className="eyebrow" id={id}>{title}</h2>
      {children}
    </section>
  );
}

function OverviewScreen({ job, detail }: { job: Job; detail: JobDetail | null }) {
  const page = detail?.page;
  const ticket = ticketFor(job, page);
  const building = page?.building;
  const outcome = building?.outcome ?? [];
  const risks = building?.risks ?? [];
  const version = text(building?.version);
  const title = text(ticket?.title);
  const url = text(ticket?.url);
  return (
    <div className="sb-phone-scroll">
      <header className="sb-phone-head">
        <div className="sb-phone-nav"><Back to={toJob(job.slug)}>{job.title || job.slug}</Back></div>
        <h1 className="sb-phone-title">Overview</h1>
      </header>
      <div className="sb-phone-ov">
        <Part title="The ticket">
          {!ticket ? <p className="sb-ov-empty">{NO_TICKET}</p> : (
            <>
              {title && <b className="sb-ov-title">{title}</b>}
              <span className="sb-ov-meta">{filedLine(ticket)}</span>
              {paragraphs(ticket.description).map((p, i) => <p key={i} className="sb-ov-desc">{p}</p>)}
              {url && (
                <a className="sb-ov-link" href={url} target="_blank" rel="noopener noreferrer" title="Opens the ticket in Orbit in a new tab.">
                  Open {ticket.key} in Orbit<Icon name="external" size={13} />
                </a>
              )}
            </>
          )}
        </Part>
        <Part title="What we’re building">
          {!building || (!outcome.length && !risks.length) ? <p className="sb-ov-empty">{BUILDING_NOT_WRITTEN}</p> : (
            <>
              <span className="sb-ov-meta">{building.from === 'brief' ? 'From the first brief' : version ? `From spec v${version}` : 'From the spec'}</span>
              {outcome.map((line, i) => <p key={i} className="sb-ov-desc">{line}</p>)}
              {risks.length > 0 && (
                <>
                  <b className="sb-ov-label">Risks</b>
                  <ul className="sb-ov-list">
                    {risks.map((line, i) => <li key={i}><Icon name="warn" size={14} className="sb-ov-mark is-warn" /><span>{line}</span></li>)}
                  </ul>
                </>
              )}
            </>
          )}
        </Part>
        <Part title="What to check"><WhatToCheck check={page?.check} /></Part>
      </div>
    </div>
  );
}
