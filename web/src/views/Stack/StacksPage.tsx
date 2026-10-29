// Stacks (#/stacks), from the approved Stack wireframe: every stack in a row, with four dots for
// Plan, Build, Merge and Push (green is done, the ringed dot is now) and a word beside them that
// says what it needs, so colour is never alone. "How stacks work" brings back the three picture
// cards at any time; they also open by themselves on the first visit. With no stacks yet the page
// shows the same three cards and one button to the Inbox, where every ticket has Start as stack.
// When this dashboard runs from its own repository with packet worktrees, the first row is the build
// stack: those packets as one read-only stack (views/Stack/BuildStack.tsx), where the integration
// board used to be.
import { useEffect, useRef } from 'react';
import type { IntegrateView, StackStep, StackSummary } from '../../api/types';
import { hrefFor, stackHref } from '../../app/router';
import { BUILD_NAME, buildSummary, useIntegrate } from './BuildStack';
import { Hero, Page } from '../../components/page/Page';
import { Icon } from '../../components/Icon';
import { StackGuide, StackGuideCards, useStackGuide } from './StackGuide';
import { STEP_INFO, summaryChip, summaryLine } from './stackModel';
import { useStacksList } from './useStacks';
import './stack.css';

/** The four dots: done, now or not yet, each with its step's name and state in words. */
export function StepDots({ steps, label }: { steps: StackStep[]; label: string }) {
  const words = steps.map((s) => `${STEP_INFO[s.id].label}: ${s.state === 'done' ? 'done' : s.state === 'now' ? 'now' : 'not yet'}`).join(', ');
  return (
    <span className="step-dots" role="img" aria-label={`${label}. ${words}`} title={words}>
      {steps.map((s) => <span key={s.id} className={`step-dot is-${s.state}`} />)}
    </span>
  );
}

function StackRow({ s }: { s: StackSummary }) {
  const chip = summaryChip(s);
  return (
    <li className="stacks-row">
      <a className="stacks-row-link" href={stackHref(s.slug)} title={s.needs}>
        <span className="stacks-row-name">
          <b>{s.title || s.slug}</b>
          <span className="muted num">{summaryLine(s)}</span>
        </span>
        <StepDots steps={s.steps} label="Where it is" />
        <span className={`chip state-chip is-${chip.tone}`}><Icon name={chip.tone === 'needs-you' ? 'hand' : chip.tone === 'done' ? 'circle-check' : 'loader'} size={14} /> {chip.word}</span>
        <Icon name="chevron-right" size={16} className="stacks-row-go" />
      </a>
    </li>
  );
}

/** The build stack's row: this app's own packets. */
function BuildRow({ view }: { view: IntegrateView | null }) {
  if (!view || (!view.packets.length && !view.order.length)) return null;
  const s = buildSummary(view);
  return (
    <li className="stacks-row">
      <a className="stacks-row-link" href={hrefFor({ name: 'stack-build' })} title="This app’s own packets, merged in order with both test suites. Nothing here pushes.">
        <span className="stacks-row-name">
          <b>{BUILD_NAME}</b>
          <span className="muted">This app’s packets · {s.parts} {s.parts === 1 ? 'part' : 'parts'} · read-only</span>
        </span>
        <StepDots steps={s.steps} label="Where it is" />
        <span className={`chip state-chip is-${s.tone}`}><Icon name={s.tone === 'needs-you' ? 'hand' : s.tone === 'done' ? 'circle-check' : 'loader'} size={14} /> {s.word}</span>
        <Icon name="chevron-right" size={16} className="stacks-row-go" />
      </a>
    </li>
  );
}

export function StacksPage() {
  const { list, unavailable, error, refresh } = useStacksList();
  const build = useIntegrate();
  const hasBuild = Boolean(build.view && (build.view.packets.length || build.view.order.length));
  const [guideOpen, setGuideOpen] = useStackGuide();
  const stacks = list?.stacks ?? [];
  // With no stacks the cards are on the page already: the first visit doesn't put them on top too.
  const asked = useRef(false);
  const empty = Boolean(list) && !stacks.length && !hasBuild;
  useEffect(() => { if (empty && guideOpen && !asked.current) setGuideOpen(false); }, [empty, guideOpen]);
  const how = (
    <button type="button" className="btn btn-quiet page-how" onClick={() => { asked.current = true; setGuideOpen(true); }} title="The three things to know about stacks.">
      <Icon name="help" size={16} /> How stacks work
    </button>
  );
  let body;
  if (unavailable) {
    body = <Hero icon="layers" title="Stacks run on your own computer">{unavailable} Open the dashboard on the computer where the jobs run.</Hero>;
  } else if (error && !list) {
    body = (
      <section className="stack-empty" role="alert">
        <p>Couldn’t load the stacks: {error}</p>
        <button type="button" className="btn btn-lg" onClick={refresh}>Try again</button>
      </section>
    );
  } else if (!list) {
    body = <p className="muted" role="status">Loading the stacks…</p>;
  } else if (!stacks.length && !hasBuild) {
    body = (
      <section className="stacks-empty" aria-label="No stacks yet">
        <h3 className="hero-title">Big ticket? Build it as a stack.</h3>
        <StackGuideCards />
        <div className="hero-actions stacks-empty-actions">
          <a className="btn btn-primary btn-lg" href={hrefFor({ name: 'inbox' })} title="Your Orbit tickets. Each one has Start as stack (keys: g i).">
            Pick a ticket in the Inbox <kbd className="kbd key-hint" aria-hidden="true">g i</kbd>
          </a>
        </div>
        <p className="muted">In the Inbox, Start as stack is beside Start on every ticket.</p>
      </section>
    );
  } else {
    body = (
      <ul className="stacks-list" aria-label="Stacks">
        <BuildRow view={build.view} />
        {stacks.map((s) => <StackRow key={s.slug} s={s} />)}
      </ul>
    );
  }
  return (
    <Page label="Stacks" title="Stacks" className="page-stacks" head={how}>
      {body}
      {guideOpen && <StackGuide done="Show me the stacks" onClose={() => setGuideOpen(false)} />}
    </Page>
  );
}
