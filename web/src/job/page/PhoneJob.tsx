// The job page on a phone (Part 3, design 3.4, note 12): four simple screens, one column each,
// chosen by the address. Not the laptop page squeezed.
//   The job (#/job/<slug>): back to Jobs and the gear; the title, the state in a word and the ticket;
//     who started it; a branch Starbase only guessed (BranchGuess, with This is the job's branch, its
//     line alone on the website); the bar with its card; the seven steps as rows; Overview, Copy
//     decisions, What Auto decided (once Auto has decided) and the Auto switch; Conversation fixed at
//     the bottom with how many messages are new.
//   A step (#/job/<slug>/stage/<step>): back to the job by its title; the step's name, state and time;
//     the step's own panel and body, as on a laptop. The screen of the step that waits for you
//     carries the bar and its three calls first, the card folded to one row (the owner's requirement).
//   The conversation (#/job/<slug>/conversation): the conversation panel, full screen.
//   The overview (#/job/<slug>/overview): the ticket, what we're building and what to check, open.
// JobPage draws it in a narrow window (760 px and under), in place of the laptop's layout.
// Each row goes by `navigate` (a new history entry), so Back returns to the job. A screen's back row
// goes back in the history when the screen before was this job's (the history does not grow), else
// to the job's screen. Writing to the Foreman (the bar's Reply while no gate waits, the c key, a
// decision the card hands to the message box) opens the conversation's screen with the message box
// focused. The head scrolls with the screen.
//
// The bar's three calls are NextStep's own buttons, placed by page.css (Send back and Reply side by
// side, Go under them). The caller gives the one conversation and the one sent line (useSentShown),
// so the state chip, every step row and the step's panel say the same; the evidence is asked once
// here (useJobEvidence) for the bar's card and the Test step. On the website there is no gear: one
// sentence says the menu is on the laptop.
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Job, JobDetail, StageAgent, StopId } from '../../api/types';
import { useKeyScope } from '../../app/keyRegistry';
import { navigate, type JobView } from '../../app/router';
import { useUi } from '../../app/ui';
import { Button } from '../../components/Button';
import { Chip } from '../../components/Chip';
import { Icon } from '../../components/Icon';
import { STOPS, stopOf } from '../../components/stops/stops';
import type { GateKind } from '../../lib/compose';
import { readStored } from '../../lib/stored';
import { focusMessageBox } from '../../panes/Foreman/Composer';
import { JobMenu } from '../../panes/Foreman/JobHeader';
import type { useJobConversation } from '../../panes/Foreman/ForemanPane';
import { DecisionsTab } from '../../panes/Preview/DecisionsTab';
import { useWorkshop } from '../../state/store';
import { AutoSwitch } from '../AutoSwitch';
import { BranchGuess } from '../BranchGuess';
import { CopyDecisions } from '../CopyDecisions';
import { NextStep } from '../NextStep';
import { WhatAutoDecided } from '../WhatAutoDecided';
import { ConversationPanel, newCount, seenKey } from './ConversationPanel';
import { docOwner } from './docOwner';
import { AUTO_START_WHERE, jobFacts, JobStateChip, MENU_ON_LAPTOP } from './JobTop';
import { Column, overviewNote, TheTicket, ticketFor, WhatWereBuilding } from './OverviewCard';
import { StepBody } from './StepBody';
import { StepPanel } from './StepPanel';
import { statesOf, stepState, stepTimeWords } from './stepWords';
import { recorderAgent } from './TestStep';
import { useJobEvidence, type JobEvidence } from './useJobEvidence';
import { useJobMenuRequests } from './useJobMenuRequests';
import { useStage } from './useStage';
import { WhatToCheck } from './WhatToCheck';
import './page.css';

type Conversation = ReturnType<typeof useJobConversation>;
type Sent = { kind: GateKind | null } | null;

interface ScreenProps {
  job: Job; conversation: Conversation; now: Date; sent: Sent; evidence: JobEvidence;
  /** Back to the job's screen (the back row). */
  back(): void;
  /** Reply while no gate waits: the conversation's screen, with the message box focused. */
  write(): void;
}

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
  const evidence = useJobEvidence(job);
  const { setTryOpen } = evidence;
  // The job menu's "Try it on your computer" (the Test step's screen, with Try it open) and "Review the screens".
  useJobMenuRequests(slug, () => { navigate({ name: 'stage', slug, stop: 'test' }); setTryOpen(true); });

  // The screen shown before this one: the back row goes back in the history when that was this
  // job's screen (so the history does not grow), else to the job's screen (a step opened from a link).
  const screenKey = step ? `stage/${step}` : view ?? 'job';
  const [trail, setTrail] = useState<{ now: string; before: string | null }>({ now: screenKey, before: null });
  // A document asked for (below), with the step it opens under, until you leave that step's screen.
  const [docAsk, setDocAsk] = useState<{ n: number; file: string | null; stop: StopId } | null>(null);
  if (trail.now !== screenKey) {
    setTrail({ now: screenKey, before: trail.now });
    // Leaving the document's step: a later visit shows the step's list, not the document again.
    if (docAsk && trail.now === `stage/${docAsk.stop}`) setDocAsk(null);
  }
  const fromJob = trail.before === 'job';
  const back = useCallback(() => {
    if (fromJob) window.history.back();
    else navigate({ name: 'job', slug });
  }, [fromJob, slug]);
  // Writing to the Foreman (Reply while no gate waits, the c key, a decision the card hands to the
  // message box): the conversation's screen, its message box focused once (a plain tap on
  // Conversation leaves the keyboard down). On that screen already, the cursor goes to the box.
  const focusBox = useRef(false);
  const onConvo = view === 'conversation' && !step;
  const write = useCallback(() => {
    if (onConvo) { focusMessageBox(document.querySelector('.sb-phone-convo')); return; }
    focusBox.current = true;
    navigate({ name: 'job', slug, view: 'conversation' });
  }, [slug, onConvo]);
  useKeyScope('job', { 'write': () => write() });

  // A link to one of the job's documents (a Foreman message, the Tester's report, ⌘K Open docs): the
  // step that owns the file (docOwner, the laptop's rule), else the step on screen, else the job's own
  // step. Its screen opens (a new history entry, so Back returns) and its panel opens the document
  // once. A request made before the page was there is not acted on.
  const ui = useUi();
  const handledDocs = useRef(ui.docsRequest);
  const pageDocs = conversation.thread.detail?.page?.docs;
  const stepNow = useRef(step);
  stepNow.current = step;
  const jobStep = stopOf(job.stage);
  useEffect(() => {
    if (ui.docsRequest === handledDocs.current) return;
    handledDocs.current = ui.docsRequest;
    const stop = docOwner(pageDocs, ui.docsFile) ?? stepNow.current ?? jobStep ?? STOPS[0].id;
    setDocAsk({ n: ui.docsRequest, file: ui.docsFile, stop });
    navigate({ name: 'stage', slug, stop });
  }, [ui.docsRequest, ui.docsFile, pageDocs, jobStep, slug]);
  const docRequest = useMemo(() => (docAsk && docAsk.stop === step ? { n: docAsk.n, file: docAsk.file } : undefined), [docAsk, step]);

  const props: ScreenProps = { job, conversation, now, sent, evidence, back, write };
  const which = step ? 'step' : view ?? 'job';
  return (
    <main className={`page sb-phone is-${which}`} aria-label="Job">
      {step ? <StepScreen {...props} stop={step} docRequest={docRequest} />
        : view === 'conversation' ? <ConversationScreen {...props} focusBox={focusBox} />
        : view === 'overview' ? <OverviewScreen job={job} detail={conversation.thread.detail ?? null} back={back} />
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

// ---------- The job ----------

function JobScreen({ job, conversation, now, sent, evidence, write }: ScreenProps) {
  const slug = job.slug;
  const { api } = useWorkshop();
  const hosted = Boolean(api.hosted?.());
  const { thread, run } = conversation;
  const detail = thread.detail ?? null;
  const { ticket, startedByAuto } = jobFacts(job, detail);
  const times = detail?.page?.times;
  const fresh = newCount(thread.items, readStored(seenKey(slug)));
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
            <JobStateChip job={job} sent={sent} />
            {ticket && <span className="num">{ticket}</span>}
          </div>
          {startedByAuto && <p className="sb-phone-by" title={AUTO_START_WHERE}><Icon name="bot" size={13} />{startedByAuto}</p>}
          <BranchGuess slug={slug} detail={detail} onConfirmed={thread.reload} />
        </header>
        <div className="sb-phone-body">
          <NextStep
            job={job}
            conversation={conversation}
            now={now}
            onShip={() => navigate({ name: 'stage', slug, stop: 'ship' })}
            onWatch={() => { navigate({ name: 'stage', slug, stop: 'test' }); evidence.setWatching(true); }}
            onWrite={write}
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
              <span className="sb-phone-row-note">{overviewNote(ticketFor(job, detail?.page))}</span>
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

function StepScreen({ job, conversation, now, sent, evidence, back, write, stop, docRequest }: ScreenProps & { stop: StopId; /** A document to open in this step's list (StepPanel acts on each `n` once). */ docRequest?: { n: number; file: string | null } }) {
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
  // No tab row here: the step's panel is a region named by this screen's heading.
  const headingId = useId();
  return (
    <div className="sb-phone-scroll">
      <header className="sb-phone-head">
        <div className="sb-phone-nav"><Back to={back}>{job.title || slug}</Back></div>
        <h1 className="sb-phone-title" id={headingId}><Icon name={here.icon} size={20} />{here.label}</h1>
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
            onWrite={write}
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
          docRequest={docRequest}
          bodyFirst={stop === 'test'}
          regionOf={headingId}
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

function ConversationScreen({ job, conversation, now, back, focusBox }: ScreenProps & { focusBox: { current: boolean } }) {
  // Opened by Reply: the message box takes the focus, once.
  useEffect(() => {
    if (!focusBox.current) return;
    focusBox.current = false;
    focusMessageBox(document.querySelector('.sb-phone-convo'));
  }, [focusBox]);
  return (
    <>
      <div className="sb-phone-head is-bar">
        <div className="sb-phone-nav"><Back to={back}>{job.title || job.slug}</Back></div>
      </div>
      <div className="sb-phone-convo">
        <ConversationPanel job={job} conversation={conversation} now={now} wide={false} onWide={() => {}} full />
      </div>
    </>
  );
}

// ---------- The overview ----------
// The overview card's three parts (OverviewCard.tsx), open and one under another, each under its own
// heading (h2, under the screen's h1), as drawn. Not the card's fold: its remembered state stays the laptop's.

function OverviewScreen({ job, detail, back }: { job: Job; detail: JobDetail | null; back(): void }) {
  const page = detail?.page;
  return (
    <div className="sb-phone-scroll">
      <header className="sb-phone-head">
        <div className="sb-phone-nav"><Back to={back}>{job.title || job.slug}</Back></div>
        <h1 className="sb-phone-title">Overview</h1>
      </header>
      <div className="sb-phone-ov">
        <Column title="The ticket" level={2}><TheTicket ticket={ticketFor(job, page)} /></Column>
        <Column title="What we’re building" level={2}><WhatWereBuilding building={page?.building} /></Column>
        <Column title="What to check" level={2}><WhatToCheck check={page?.check} /></Column>
      </div>
    </div>
  );
}
