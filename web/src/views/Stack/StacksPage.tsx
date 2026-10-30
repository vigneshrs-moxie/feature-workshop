// Stacks (#/stacks), redone for big features (packet V). The place you run large features from:
//   - a summary line in words with numbers ("3 stacks · 9 parts at work · 2 need you · 4 merged
//     today"); each number is a filter;
//   - one card per stack, two across on a Mac window and three from 1728 px: its goal and why, a
//     progress bar with a segment per part (a pattern and a word for each lane), the counts in
//     words, who is at work (up to three now lines), its risks, its numbers (time running, Claude
//     cost, last activity) and, in one fixed spot at the bottom of every card, what it needs from
//     you with its one action (the Desk's action row, borrowed);
//   - a fixed order: stacks that need you, then working, then finished (folded into "Finished (n)").
//     Cards never reorder under the pointer;
//   - peek: Space or a click on a card's body opens a quick look over the right side (the next step
//     and the parts); j / k move between cards, Enter opens the stack;
//   - Play full lays the Desk's faint grid behind the page, pulses each card's light while its
//     parts are at work and puts the crew's faces beside their now lines; subtle keeps the lights
//     steady; off is plain. Reduced motion keeps everything still.
// The build stack (this app's own packets, views/Stack/BuildStack.tsx) is one card like the others.
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import type { IntegrateView, PartLane, StackSegment, StackStep, StackSummary } from '../../api/types';
import { useKeyScope } from '../../app/keyRegistry';
import { hrefFor, navigate, partHref, stackHref } from '../../app/router';
import { Button } from '../../components/Button';
import { Chip } from '../../components/Chip';
import { Icon } from '../../components/Icon';
import { More } from '../../components/More';
import { Page } from '../../components/page/Page';
import { Sheet } from '../../components/Sheet';
import { relativeTime, useNow } from '../../lib/time';
import { useStored } from '../../lib/stored';
import { CrewMember } from '../../play/CrewMember';
import { usePlay } from '../../play/usePlay';
import { useWorkshop } from '../../state/store';
import { buildParts, buildSummary, useIntegrate } from './BuildStack';
import { StackBar } from './StackBar';
import { StackGuide, useStackGuide } from './StackGuide';
import { LANE_LOOK, countWords, money, runningFor, standingChip, standingTone } from './stackLook';
import { STEP_INFO } from './stackModel';
import { useStacksList } from './useStacks';
import './stack.css';
import './stacks-home.css';

/** The four dots: done, now or not yet, each with its step's name and state in words (Jobs uses them). */
export function StepDots({ steps, label }: { steps: StackStep[]; label: string }) {
  const words = steps.map((s) => `${STEP_INFO[s.id].label}: ${s.state === 'done' ? 'done' : s.state === 'now' ? 'now' : 'not yet'}`).join(', ');
  return (
    <span className="step-dots" role="img" aria-label={`${label}. ${words}`} title={words}>
      {steps.map((s) => <span key={s.id} className={`step-dot is-${s.state}`} />)}
    </span>
  );
}

export const BUILD_SLUG = '__build';
const BUILD_TITLE = 'This app’s build';

/** The build stack as a card: its packets as parts, in merge order. */
export function buildCard(view: IntegrateView): StackSummary {
  const s = buildSummary(view);
  const items = buildParts(view);
  const nextId = view.next?.id ?? null;
  const segments: StackSegment[] = items.map((it, i) => {
    const state = it.item?.state ?? it.packet?.state ?? 'unknown';
    const tests = it.packet?.testsState ?? 'unknown';
    const running = view.running?.id === it.id;
    const lane: PartLane = running ? 'merging' : state === 'merged' ? 'merged' : tests === 'running' ? 'checks' : tests === 'red' ? 'needs-you' : it.id === nextId ? 'ready' : state === 'waiting' ? 'working' : state === 'empty' || state === 'missing' ? 'queued' : 'waiting';
    const name = it.item?.name ?? it.packet?.name ?? it.id;
    return { n: i + 1, name: it.id, title: `${it.id} · ${name}`, lane, laneWords: LANE_LOOK[lane].word, slug: null };
  });
  const lanes = Object.fromEntries(Object.keys(LANE_LOOK).map((l) => [l, segments.filter((x) => x.lane === l).length])) as Record<PartLane, number>;
  const next = nextId ? segments.find((x) => x.name === nextId) ?? null : null;
  // Who is at work: each packet being built, by its last commit.
  const atWork = segments.filter((x) => x.lane === 'working' || x.lane === 'checks' || x.lane === 'merging').map((x) => {
    const p = items[x.n - 1]?.packet ?? null;
    return { n: x.n, title: x.title, slug: null, lane: x.lane, who: `Packet ${x.name}`, crew: null, what: p?.lastCommit?.subject ?? (x.lane === 'checks' ? 'running its tests' : 'building'), since: p?.lastCommit?.time ?? null, tone: 'working' as const };
  }).sort((a, b) => Date.parse(b.since ?? '') - Date.parse(a.since ?? ''));
  return {
    slug: BUILD_SLUG, title: BUILD_TITLE, ticketKey: null, phase: 'merge', steps: s.steps, parts: segments.length, counts: {}, needs: s.word, action: 'wait',
    why: 'This app’s own packets, merged in order with both test suites. Read-only here: nothing pushes.',
    standing: s.tone === 'done' ? 'done' : s.tone === 'needs-you' ? 'needs-you' : 'working', approved: true,
    total: segments.length, merged: lanes.merged, atWorkCount: lanes.working + lanes.checks + lanes.merging, needsYouCount: next ? 1 : 0, lanes, segments, atWork,
    ask: next ? { action: 'merge', label: 'Merge next', part: next.n, words: `${next.title} is next to merge` } : null,
    risks: segments.filter((x) => x.lane === 'needs-you').map((x) => ({ kind: 'checks' as const, tone: 'error' as const, parts: [x.n], words: `${x.title}: its tests failed` })),
    costUsd: 0, startedAt: null, lastActivityAt: view.last?.at ?? null, mergedToday: 0,
  };
}

type Filter = 'all' | 'needs-you' | 'at-work' | 'merged-today';
const FILTERS: Filter[] = ['all', 'needs-you', 'at-work', 'merged-today'];
const isFilter = (v: string | null): v is Filter => FILTERS.includes(v as Filter);

function passes(s: StackSummary, f: Filter) {
  if (f === 'needs-you') return s.standing === 'needs-you';
  if (f === 'at-work') return (s.atWorkCount ?? 0) > 0;
  if (f === 'merged-today') return (s.mergedToday ?? 0) > 0;
  return true;
}

const RANK = { 'needs-you': 0, working: 1, done: 2 } as const;

/**
 * The cards' order: needs you, working, done. While the pointer is over the cards, a stack keeps
 * the place it had, so nothing moves under the hand; the new order lands when the pointer leaves.
 */
function useSteadyOrder(stacks: StackSummary[], holding: boolean): StackSummary[] {
  const last = useRef<string[]>([]);
  const fresh = [...stacks].sort((a, b) => RANK[a.standing ?? 'working'] - RANK[b.standing ?? 'working']).map((s) => s.slug);
  let order = fresh;
  if (holding && last.current.length) {
    const kept = last.current.filter((slug) => fresh.includes(slug));
    order = [...kept, ...fresh.filter((slug) => !kept.includes(slug))];
  }
  last.current = order;
  const by = new Map(stacks.map((s) => [s.slug, s]));
  return order.map((slug) => by.get(slug)!).filter(Boolean);
}

export function StacksPage() {
  const { list, unavailable, error, refresh } = useStacksList();
  const build = useIntegrate();
  const play = usePlay();
  const now = useNow(30_000);
  const { api } = useWorkshop();
  const mode = play.full ? 'full' : play.on ? 'subtle' : 'off';
  const [guideOpen, setGuideOpen] = useStackGuide();
  const [storedFilter, setFilter] = useStored('gc.stacks.filter');
  const filter: Filter = isFilter(storedFilter) ? storedFilter : 'all';
  const [hovering, setHovering] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [peek, setPeek] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<StackSummary | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const all = useMemo(() => {
    const out = [...(list?.stacks ?? [])];
    if (build.view && (build.view.packets.length || build.view.order.length)) out.unshift(buildCard(build.view));
    return out;
  }, [list, build.view]);
  const ordered = useSteadyOrder(all, hovering);
  const open = ordered.filter((s) => s.standing !== 'done');
  const done = ordered.filter((s) => s.standing === 'done');
  const shown = open.filter((s) => passes(s, filter));
  const shownDone = filter === 'all' ? done : done.filter((s) => passes(s, filter));
  const pickable = [...shown, ...shownDone].map((s) => s.slug);

  const hrefOf = (slug: string) => (slug === BUILD_SLUG ? hrefFor({ name: 'stack-build' }) : stackHref(slug));
  const step = (by: number) => {
    if (!pickable.length) return;
    const at = picked ? pickable.indexOf(picked) : -1;
    const next = pickable[(at + by + pickable.length) % pickable.length] ?? pickable[0];
    setPicked(next);
    if (peek) setPeek(next);
    document.querySelector(`[data-stack="${CSS.escape(next)}"]`)?.scrollIntoView({ block: 'nearest' });
  };
  useKeyScope('stack', {
    'stacks-next': () => step(1),
    'stacks-prev': () => step(-1),
    'stacks-peek': () => { const s = picked ?? pickable[0]; if (s) { setPicked(s); setPeek((p) => (p === s ? null : s)); } },
    'stacks-open': () => { const s = picked ?? pickable[0]; if (s) navigate(s === BUILD_SLUG ? { name: 'stack-build' } : { name: 'stack', slug: s }); },
  }, !confirm && !guideOpen);

  async function act(s: StackSummary) {
    const ask = s.ask;
    if (!ask) return;
    if (s.slug === BUILD_SLUG || ask.action === 'approve-plan' || ask.action === 'fix-plan' || ask.action === 'push') { navigate(s.slug === BUILD_SLUG ? { name: 'stack-build' } : { name: 'stack', slug: s.slug }); return; }
    if (ask.action === 'open-part' && ask.part) { navigate({ name: 'stack-part', slug: s.slug, n: ask.part }); return; }
    if (ask.action === 'merge') { setConfirm(s); return; }
    const section = s.segments?.find((x) => x.n === ask.part)?.name;
    setBusy(s.slug);
    setProblem(null);
    try { await api.post(`/api/stacks/${encodeURIComponent(s.slug)}/send-back`, { section }); refresh(); } catch (err) { setProblem(err instanceof Error ? err.message : String(err)); } finally { setBusy(null); }
  }
  async function merge(s: StackSummary) {
    const section = s.segments?.find((x) => x.n === s.ask?.part)?.name;
    setBusy(s.slug);
    setProblem(null);
    try { await api.post(`/api/stacks/${encodeURIComponent(s.slug)}/merge`, { section }); setConfirm(null); refresh(); } catch (err) { setProblem(err instanceof Error ? err.message : String(err)); } finally { setBusy(null); }
  }

  const peeked = peek ? all.find((s) => s.slug === peek) ?? null : null;
  const totals = {
    stacks: all.length,
    atWork: all.reduce((a, s) => a + (s.atWorkCount ?? 0), 0),
    needsYou: all.filter((s) => s.standing === 'needs-you').length,
    mergedToday: all.reduce((a, s) => a + (s.mergedToday ?? 0), 0),
  };

  let body: ReactNode;
  if (unavailable) {
    body = <StacksEmpty title="Stacks run on your own computer" say={`${unavailable} Open the dashboard on the computer where the jobs run.`} onHow={() => setGuideOpen(true)} />;
  } else if (error && !list) {
    body = (
      <section className="stacks-home-error" role="alert">
        <Icon name="warn" size={18} />
        <p>Couldn’t load the stacks: {error}. Nothing was lost; the stacks carry on without this page.</p>
        <Button onClick={refresh}>Try again</Button>
      </section>
    );
  } else if (!list) {
    body = <SkeletonCards />;
  } else if (!all.length) {
    body = <StacksEmpty onHow={() => setGuideOpen(true)} />;
  } else {
    const card = (s: StackSummary) => (
      <StackHomeCard
        key={s.slug} s={s} href={hrefOf(s.slug)} now={now} mode={mode} pulse={play.animated}
        picked={picked === s.slug} peeked={peek === s.slug} busy={busy === s.slug}
        onPeek={() => { setPicked(s.slug); setPeek((p) => (p === s.slug ? null : s.slug)); }}
        onAct={() => void act(s)}
      />
    );
    body = (
      <div className="stacks-home-body" onPointerEnter={() => setHovering(true)} onPointerLeave={() => setHovering(false)}>
        {problem && <p className="field-problem stacks-home-problem" role="alert">{problem} <Button kind="quiet" size="sm" onClick={() => setProblem(null)}>Dismiss</Button></p>}
        {shown.length
          ? <ul className="stacks-grid" aria-label="Stacks">{shown.map(card)}</ul>
          : <p className="stacks-none muted">{filter === 'all' ? 'Every stack is finished.' : 'No stack matches this filter.'} <Button kind="quiet" size="sm" onClick={() => setFilter(null)}>Show every stack</Button></p>}
        {shownDone.length > 0 && (
          <More screen="stacks" id="finished" label="Finished" count={shownDone.length} icon="circle-check" note="merged and pushed">
            <ul className="stacks-grid is-done" aria-label="Finished stacks">{shownDone.map(card)}</ul>
          </More>
        )}
      </div>
    );
  }

  return (
    <Page
      label="Stacks"
      title="Stacks"
      className={`page-stacks-home play-${mode}${play.full ? ' has-grid' : ''}`}
      head={(
        <>
          {list && all.length > 0 && <SummaryLine totals={totals} filter={filter} onFilter={(f) => setFilter(f === 'all' || f === filter ? null : f)} />}
          <span className="spacer" />
          <Button kind="quiet" icon="help" className="page-how" onClick={() => setGuideOpen(true)} title="What a stack is and how its parts are built and merged.">How stacks work</Button>
        </>
      )}
    >
      {body}
      {peeked && (
        <StackPeek
          s={peeked} href={hrefOf(peeked.slug)} now={now} busy={busy === peeked.slug}
          onAct={() => void act(peeked)} onClose={() => setPeek(null)}
        />
      )}
      {confirm && (
        <Sheet title={`Merge part ${confirm.ask?.part ?? ''}?`} onClose={() => setConfirm(null)} busy={busy === confirm.slug}>
          <p className="muted">{confirm.ask?.words}. It joins {confirm.parentBranch ?? 'the stack’s branch'}, then the checks run. If they fail, the merge is undone and the part goes back to its Foreman. Nothing is pushed.</p>
          <div className="sheet-actions">
            <Button size="lg" onClick={() => setConfirm(null)} disabled={busy === confirm.slug}>Not now</Button>
            <Button kind="primary" size="lg" busy={busy === confirm.slug} onClick={() => void merge(confirm)} data-autofocus>Merge part {confirm.ask?.part}</Button>
          </div>
        </Sheet>
      )}
      {guideOpen && <StackGuide done="Show me the stacks" onClose={() => setGuideOpen(false)} />}
    </Page>
  );
}

/** "3 stacks · 9 parts at work · 2 need you · 4 merged today": each number a filter. */
function SummaryLine({ totals, filter, onFilter }: { totals: { stacks: number; atWork: number; needsYou: number; mergedToday: number }; filter: Filter; onFilter: (f: Filter) => void }) {
  const item = (f: Filter, n: number, words: string, hint: string, tone = '') => (
    <button type="button" className={`stacks-sum-item${tone ? ` is-${tone}` : ''}${filter === f ? ' is-on' : ''}`} aria-pressed={filter === f} onClick={() => onFilter(f)} title={filter === f && f !== 'all' ? 'Show every stack again.' : hint}>
      <b className="num">{n}</b> {words}
    </button>
  );
  return (
    <nav className="stacks-sum" aria-label="Stacks at a glance">
      {item('all', totals.stacks, totals.stacks === 1 ? 'stack' : 'stacks', 'Show every stack.')}
      <span className="stacks-sum-sep" aria-hidden="true">·</span>
      {item('at-work', totals.atWork, totals.atWork === 1 ? 'part at work' : 'parts at work', 'Show only the stacks with parts at work.', totals.atWork ? 'info' : '')}
      <span className="stacks-sum-sep" aria-hidden="true">·</span>
      {item('needs-you', totals.needsYou, totals.needsYou === 1 ? 'needs you' : 'need you', 'Show only the stacks that need you.', totals.needsYou ? 'warn' : '')}
      <span className="stacks-sum-sep" aria-hidden="true">·</span>
      {item('merged-today', totals.mergedToday, 'merged today', 'Show only the stacks with a part merged today.', totals.mergedToday ? 'ok' : '')}
    </nav>
  );
}

const TONE_ICON = { working: 'loader', waiting: 'hand', quiet: 'clock' } as const;

function StackHomeCard({ s, href, now, mode, pulse, picked, peeked, busy, onPeek, onAct }: {
  s: StackSummary; href: string; now: Date; mode: 'full' | 'subtle' | 'off'; pulse: boolean; picked: boolean; peeked: boolean; busy: boolean;
  onPeek: () => void; onAct: () => void;
}) {
  const chip = standingChip(s);
  const tone = standingTone(s);
  const atWork = s.atWork ?? [];
  const working = (s.atWorkCount ?? 0) > 0;
  const total = s.total ?? s.parts;
  const lanes = s.lanes ?? {};
  const ran = runningFor(s.startedAt, now);
  const last = s.lastActivityAt ? relativeTime(s.lastActivityAt, now) : null;
  const numbers = [
    ran && { k: 'running', text: ran, hint: `Running for ${ran}, since the plan was approved.` },
    s.slug !== BUILD_SLUG && s.approved !== false && { k: 'cost', text: money(s.costUsd), hint: 'What Claude has cost so far for this stack: its parts’ jobs together, from Telemetry’s record.' },
    last && { k: 'last', text: last === 'just now' || last === 'yesterday' || !/^\d/.test(last) ? last : `${last} ago`, hint: 'When something last happened on it.' },
  ].filter(Boolean) as { k: string; text: string; hint: string }[];
  // A click on the card's own body peeks; links and buttons inside keep their own clicks.
  const onBody = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('a, button')) onPeek(); };
  return (
    <li className={`stack-home-card edge-${tone}${picked ? ' is-picked' : ''}${peeked ? ' is-peeked' : ''}`} data-stack={s.slug} onClick={onBody}>
      <header className="shc-head">
        {mode !== 'off' && <span className={`stack-light tone-${tone}${working ? ' is-on' : ''}${working && mode === 'full' && pulse ? ' is-pulse' : ''}`} aria-hidden="true" />}
        <a className="shc-title" href={href} title={`Open ${s.title || s.slug} (key: Enter).`}>{s.title || s.slug}</a>
        {s.ticketKey && <span className="shc-ticket num">{s.ticketKey}</span>}
        <span className="spacer" />
        <Chip tone={chip.tone} icon={chip.icon}>{chip.word}</Chip>
      </header>
      {s.why ? <p className="shc-why" title={s.why}>{s.why}</p> : <p className="shc-why is-empty muted">{s.approved === false ? 'The plan is written; check it to start building.' : 'No reason written in the plan.'}</p>}

      <div className="shc-progress">
        <StackBar segments={s.segments ?? []} hrefFor={s.slug === BUILD_SLUG ? undefined : (x) => partHref(s.slug, x.n)} />
        <div className="shc-counts">
          <span className="shc-count-words">{s.approved === false ? `${total} parts planned · none started yet` : countWords(lanes, total)}</span>
          <span className="shc-numbers num">
            {numbers.map((n, i) => <span key={n.k} title={n.hint}>{i > 0 && <span className="shc-dot" aria-hidden="true">·</span>}{n.text}</span>)}
          </span>
        </div>
      </div>

      <section className="shc-work" aria-label="At work">
        {atWork.length ? (
          <ul className="shc-now-list">
            {atWork.slice(0, 3).map((w) => (
              <li key={w.n} className={`shc-now lane-${w.lane}`}>
                {mode === 'full' && w.crew
                  ? <span className="shc-face" aria-hidden="true"><CrewMember type={w.crew} state="working" size={22} label="" animated={false} /></span>
                  : <Icon name={w.lane === 'checks' ? 'flask' : TONE_ICON[w.tone]} size={14} className={`shc-now-icon tone-${LANE_LOOK[w.lane].tone}`} />}
                {s.slug === BUILD_SLUG
                  ? <span className="shc-now-part">{w.who}</span>
                  : <a className="shc-now-part" href={partHref(s.slug, w.n)} title={`Open part ${w.n}: ${w.title}.`}>Part {w.n}</a>}
                <span className="shc-now-text">{s.slug === BUILD_SLUG ? <>last commit · {w.what}</> : <><b>{w.who}</b> · {w.what}</>}</span>
                {w.since && <time className="shc-now-time num" dateTime={w.since}>{relativeTime(w.since, now)}</time>}
              </li>
            ))}
            {atWork.length > 3 && <li className="shc-now-more muted">and {atWork.length - 3} more</li>}
          </ul>
        ) : (
          <p className="shc-now-none muted">{s.standing === 'done' ? 'Finished: every part is merged.' : s.approved === false ? 'Nobody at work until the plan is approved.' : 'Nobody at work right now.'}</p>
        )}
      </section>

      {/* Risks, only when there are some; their slot keeps its size either way, so a card never grows. */}
      <div className="shc-risk-slot">
        {(s.risks?.length ?? 0) > 0 && (
          <ul className="shc-risks" aria-label="Risks">
            {s.risks!.slice(0, 2).map((r) => (
              <li key={r.words} className={`shc-risk tone-${r.tone}`}><Icon name={r.tone === 'error' ? 'warn' : 'alert'} size={14} /> <span>{r.words}</span></li>
            ))}
            {s.risks!.length > 2 && <li className="shc-risk-more muted">and {s.risks!.length - 2} more on the stack’s page</li>}
          </ul>
        )}
      </div>

      <footer className={`shc-ask${s.ask ? ' has-ask' : ''}`}>
        {s.ask ? (
          <>
            <Icon name="hand" size={16} className="shc-ask-icon" />
            <span className="shc-ask-words" title={s.ask.words}>{s.ask.words}</span>
            <Button size="sm" kind={s.ask.action === 'merge' || s.ask.action === 'approve-plan' ? 'primary' : 'secondary'} busy={busy} onClick={onAct} title={askHint(s)}>{s.ask.label}</Button>
          </>
        ) : (
          <>
            <Icon name={s.standing === 'done' ? 'circle-check' : 'clock'} size={16} className="shc-ask-icon" />
            <span className="shc-ask-words muted">{s.standing === 'done' ? 'Nothing left to do here' : s.nextToMerge ? `Nothing needs you · we’ll say when part ${s.nextToMerge} is ready` : 'Nothing needs you right now'}</span>
          </>
        )}
      </footer>
    </li>
  );
}

function askHint(s: StackSummary): string {
  switch (s.ask?.action) {
    case 'merge': return s.slug === BUILD_SLUG ? 'Open the build stack, where Merge next runs both test suites.' : 'Merge it into the stack’s branch, then run the checks. Asks first.';
    case 'fix': return 'Send it back to its Foreman with what went wrong.';
    case 'open-part': return 'Open the part’s page: what went wrong, its changes and its checks.';
    case 'approve-plan': return 'Open the stack to check its parts and approve the plan.';
    case 'push': return 'Open the stack: pushing asks go / no go first.';
    default: return 'Open the stack.';
  }
}

/** A quick look: the next step and every part with its lane, over the right side of the page. */
function StackPeek({ s, href, now, busy, onAct, onClose }: { s: StackSummary; href: string; now: Date; busy: boolean; onAct: () => void; onClose: () => void }) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('[aria-modal="true"]')) { e.preventDefault(); close.current(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const chip = standingChip(s);
  const segs = s.segments ?? [];
  return (
    <aside className="peek stack-peek" role="dialog" aria-modal="false" aria-label={`${s.title || s.slug}: a quick look`}>
      <header className="peek-head">
        <h3 className="peek-title">{s.title || s.slug}</h3>
        <Chip tone={chip.tone} icon={chip.icon}>{chip.word}</Chip>
        <span className="spacer" />
        <Button kind="quiet" size="sm" href={href} title="Open the whole stack: its board, map and timeline (key: Enter).">Open the stack</Button>
        <Button kind="quiet" size="sm" iconOnly icon="x" aria-label="Close" title="Close this quick look; the cards stay as they were (key: Esc)." onClick={onClose} />
      </header>
      <div className="peek-body">
        <section className={`stack-peek-next${s.ask ? ' has-ask' : ''}`} aria-label="Next step">
          <span className="eyebrow">{s.ask ? 'Needs you' : 'Next'}</span>
          <p className="stack-peek-say">{s.ask?.words ?? (s.standing === 'done' ? 'Every part is merged and pushed.' : s.nextToMerge ? `Nothing needs you. Part ${s.nextToMerge} merges next, when it is ready.` : 'Nothing needs you right now.')}</p>
          {s.ask && <div className="stack-peek-act"><Button kind="primary" busy={busy} onClick={onAct} title={askHint(s)}>{s.ask.label}</Button></div>}
        </section>
        <StackBar segments={segs} size="lg" hrefFor={s.slug === BUILD_SLUG ? undefined : (x) => partHref(s.slug, x.n)} />
        <p className="muted stack-peek-counts">{countWords(s.lanes ?? {}, s.total ?? s.parts)}</p>
        <ol className="stack-peek-parts" aria-label="Parts, in merge order">
          {segs.map((x) => {
            const look = LANE_LOOK[x.lane];
            const now1 = s.atWork?.find((w) => w.n === x.n);
            return (
              <li key={x.n} className={`stack-peek-part lane-${x.lane}`}>
                <span className="part-num num">{x.n}</span>
                {s.slug === BUILD_SLUG ? <span className="stack-peek-name">{x.title}</span> : <a className="stack-peek-name" href={partHref(s.slug, x.n)}>{x.title}</a>}
                <span className={`stack-peek-lane tone-${look.tone}`}><Icon name={look.icon} size={13} /> {x.laneWords || look.word}</span>
                {now1 && <span className="stack-peek-now muted">{now1.who} · {now1.what}{now1.since ? ` · ${relativeTime(now1.since, now)}` : ''}</span>}
              </li>
            );
          })}
        </ol>
      </div>
      <footer className="peek-foot">
        <span><kbd className="kbd">j</kbd> <kbd className="kbd">k</kbd> the next or previous stack</span>
        <span><kbd className="kbd">↵</kbd> open it</span>
        <span><kbd className="kbd">Esc</kbd> close</span>
      </footer>
    </aside>
  );
}

/** The cards' shape while the first answer comes: the same size as the cards, so nothing moves. */
function SkeletonCards() {
  return (
    <ul className="stacks-grid is-loading" aria-label="Loading the stacks" aria-busy="true">
      {[0, 1].map((i) => <li key={i} className="stack-home-card is-skeleton"><span /><span /><span /><span /></li>)}
    </ul>
  );
}

/** No stacks yet: what a stack is, when to use one, and the one way to start. */
function StacksEmpty({ title = 'Build a big feature as a stack', say, onHow }: { title?: string; say?: string; onHow: () => void }) {
  return (
    <section className="stacks-empty-v" aria-label={title}>
      <span className="stacks-empty-pic" aria-hidden="true">
        {[0, 1, 2].map((i) => <span key={i} className={`stacks-empty-bar b${i}`} />)}
      </span>
      <h3 className="stacks-empty-title">{title}</h3>
      {say ? <p className="stacks-empty-say">{say}</p> : (
        <>
          <p className="stacks-empty-say">A stack splits a big ticket into parts. Each part is built side by side by its own Foreman, on its own copy of the code. Then the parts join your branch one at a time, in order, with the tests run after each.</p>
          <p className="stacks-empty-say muted">Use one when a ticket touches several areas that can be built separately, like a billing flow with its screens and emails. For a small change, a single job is quicker.</p>
        </>
      )}
      <div className="stacks-empty-actions">
        <Button kind="primary" size="lg" icon="inbox" href={hrefFor({ name: 'inbox' })} title="Your tickets: each one has Start as stack (keys: g i).">Start a stack from a ticket</Button>
        <Button size="lg" icon="help" onClick={onHow} title="The three things to know about stacks.">How stacks work</Button>
      </div>
    </section>
  );
}
