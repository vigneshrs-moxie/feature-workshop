// A part's own page (#/stack/<slug>/part/<n>, packet V). It looks and works like the Job page,
// which it is underneath (the part's own job: its go / no go, its conversation and message box),
// with its place in the stack around it:
//   - the header: "Part 4 of 12 · Email delivery", the way back to the stack, its lane in a word,
//     the previous and next part ([ and ]) and Open the job (o);
//   - a context strip: what it is for, what it waits on and what waits on it (links), the files it
//     owns, its branch and port;
//   - the main column: the stack's problem with this part, when it has one (a clash, stuck, tests
//     failed after merging and undone), the job's own go / no go bar when it waits for you, the now
//     line; Ready to merge (a short checklist in words with icons) beside Checks (the result of its
//     last merge attempt); and its history grouped by kind and folded;
//   - the side column: Changes (its files with + and − against the stack's branch, read-only, a
//     click for one file's diff) and the conversation with its Foreman with the message box.
//     Merge asks first, as the stack's does. Pushing stays on the stack's page.
// The job's level sits in the context strip ("Level  Not chosen yet · Choose"), and its choice opens
// in a sheet, so the conversation column holds only the conversation.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Job, JobDetail, PartPageData } from '../../api/types';
import { useKeyScope } from '../../app/keyRegistry';
import { useMinWidth } from '../../components/page/Page';
import { jobHref, navigate, partHref, stackHref, stacksHref } from '../../app/router';
import { Button } from '../../components/Button';
import { Chip } from '../../components/Chip';
import { Icon } from '../../components/Icon';
import { More } from '../../components/More';
import { NextBar, Page } from '../../components/page/Page';
import { Pending, Skeleton } from '../../components/Pending';
import { Sheet } from '../../components/Sheet';
import { NextStep } from '../../job/JobPage';
import { isLevel, levelCardKey, levelCardView, levelLabel } from '../../lib/levels';
import { useStored } from '../../lib/stored';
import { relativeTime, useNow } from '../../lib/time';
import { Composer } from '../../panes/Foreman/Composer';
import { ThreadList, useCurrentJob, useJobConversation } from '../../panes/Foreman/ForemanPane';
import { LevelCard, levelFacts } from '../../panes/Foreman/LevelCard';
import { usePlay } from '../../play/usePlay';
import { jobBySlug } from '../../state/reducer';
import { useWorkshopState } from '../../state/store';
import { LANE_LOOK, money } from './stackLook';
import { useStackPart, type PartState } from './useStacks';
import '../../job/job.css';
import './stacks-home.css';
import './stack-page.css';
import './part-page.css';

export function PartPage({ slug, n }: { slug: string; n: number }) {
  const part = useStackPart(slug, n);
  const { page, missing, error } = part;
  if (!page) {
    return (
      <Page label="Part" title={missing ? 'No such part' : `Part ${n}`} className="page-part">
        {missing ? (
          <section className="stacks-home-error" role="alert"><Icon name="warn" size={18} /><p>{missing}</p><Button href={stackHref(slug)}>Back to the stack</Button></section>
        ) : error ? (
          <section className="stacks-home-error" role="alert"><Icon name="warn" size={18} /><p>Couldn’t load the part: {error}. Nothing was lost.</p><Button onClick={part.refresh}>Try again</Button></section>
        ) : <Pending loading say="Loading the part…" skeleton={<Skeleton rows={6} className="part-skeleton" />} />}
      </Page>
    );
  }
  return <PartBody key={`${slug}-${n}`} state={part} page={page} />;
}

function PartBody({ state, page }: { state: PartState; page: PartPageData }) {
  const now = useNow(30_000);
  const play = usePlay();
  const wide = useMinWidth(1280);
  const store = useWorkshopState();
  const { stack, part: p } = page;
  const job = p.slug ? jobBySlug(store, p.slug) ?? null : null;
  const lane = p.lane ?? 'waiting';
  const look = LANE_LOOK[lane];
  const [confirm, setConfirm] = useState(false);
  const [file, setFile] = useState<string | null>(null);
  const [jobDetail, setJobDetail] = useState<JobDetail | null>(null);
  const [levelOpen, setLevelOpen] = useState(false);
  const mode = play.full ? 'full' : play.on ? 'subtle' : 'off';

  useKeyScope('stack', {
    'part-prev': () => { if (page.prev) navigate({ name: 'stack-part', slug: stack.slug, n: page.prev.n }); },
    'part-next': () => { if (page.next) navigate({ name: 'stack-part', slug: stack.slug, n: page.next.n }); },
    'part-job': () => { if (p.slug) navigate({ name: 'job', slug: p.slug }); },
  }, !confirm && !file && !levelOpen);

  const canMerge = p.state === 'ready' && stack.nextToMerge === p.name && !stack.autoIntegrate && !stack.busy;
  return (
    <Page
      label="Part"
      title={<><span className="part-title-n">Part {p.n} of {stack.total}</span><span className="part-title-dot" aria-hidden="true">·</span>{p.title ?? p.name}</>}
      className={`page-part play-${mode}${play.full ? ' has-grid' : ''}${wide ? ' is-wide' : ''}`}
      head={(
        <>
          <Chip tone={look.chip} icon={look.icon}>{p.laneWords ?? look.word}</Chip>
          <span className="spacer" />
          <div className="part-steps" role="group" aria-label="Other parts">
            <Button kind="quiet" size="sm" icon="chevron-left" disabled={!page.prev} keyId="part-prev" onClick={() => page.prev && navigate({ name: 'stack-part', slug: stack.slug, n: page.prev.n })} title={page.prev ? `Part ${page.prev.n}: ${page.prev.title} (key: [).` : 'This is the first part.'}>{page.prev ? `Part ${page.prev.n}` : 'First part'}</Button>
            <Button kind="quiet" size="sm" disabled={!page.next} keyId="part-next" onClick={() => page.next && navigate({ name: 'stack-part', slug: stack.slug, n: page.next.n })} title={page.next ? `Part ${page.next.n}: ${page.next.title} (key: ]).` : 'This is the last part.'}>{page.next ? `Part ${page.next.n}` : 'Last part'} <Icon name="chevron-right" size={14} /></Button>
          </div>
          {p.slug && <Button href={jobHref(p.slug)} icon="external" keyId="part-job" title="Open the part’s own job: every stop, its documents and its crew (key: o).">Open the job</Button>}
        </>
      )}
    >
      <nav className="stack-crumbs" aria-label="Where you are">
        <a href={stacksHref()}>Stacks</a><Icon name="chevron-right" size={12} />
        <a href={stackHref(stack.slug)}>{stack.title || stack.slug}</a><Icon name="chevron-right" size={12} />
        <span>Part {p.n}</span>
      </nav>
      <ContextStrip page={page} level={job ? <LevelFact job={job} detail={jobDetail} onChoose={() => setLevelOpen(true)} /> : null} />
      <div className="job-layout part-layout">
        <div className="job-main">
          <PartProblemBar page={page} state={state} onMerge={() => setConfirm(true)} canMerge={canMerge} />
          {/* The part's own job's go / no go while it is being built; past that, the stack's bar above says what is next. */}
          {job && p.state === 'running' && job.needsYou ? <JobNext job={job} now={now} /> : job ? null : (
            <p className="part-no-job muted">{p.slug ? 'Its job shows here once the dashboard has read it.' : lane === 'waiting' ? `It starts once ${p.waitsOn?.map((x) => `part ${x}`).join(' and ') || 'the parts it waits on'} ${p.waitsOn?.length === 1 ? 'has' : 'have'} merged. Its job, conversation and changes show here then.` : 'It hasn’t started yet. Its job, conversation and changes show here once it does.'}</p>
          )}
          {p.now && (
            <p className={`now-line is-${p.now.tone} part-now`} aria-label="Now">
              <Icon name={p.now.tone === 'waiting' ? 'hand' : p.now.tone === 'quiet' ? 'circle-check' : 'loader'} size={14} className="now-icon" />
              <b className="now-who">{p.now.who}</b><span className="now-sep" aria-hidden="true">·</span><span className="now-what">{p.now.what}</span>
              {p.now.since && <><span className="now-sep" aria-hidden="true">·</span><time className="now-time num" dateTime={p.now.since}>{relativeTime(p.now.since, now)}</time></>}
            </p>
          )}
          <div className="part-merge-row">
            <Checklist page={page} canMerge={canMerge} busy={state.sending} onMerge={() => setConfirm(true)} />
            <Checks page={page} now={now} />
          </div>
          <History page={page} now={now} />
        </div>
        <aside className="job-side part-side" aria-label="Its conversation and changes">
          <Changes page={page} onOpen={setFile} />
          {job && <Conversation job={job} now={now} wide={wide} onDetail={setJobDetail} />}
        </aside>
      </div>
      {state.problem && <p className="field-problem" role="alert">{state.problem} <Button kind="quiet" size="sm" onClick={state.clearProblem}>Dismiss</Button></p>}
      {confirm && (
        <Sheet title={`Merge part ${p.n}?`} onClose={() => setConfirm(false)} busy={state.sending}>
          <p className="muted">Part {p.n} ({p.title ?? p.name}) joins {stack.parentBranch ?? 'the stack’s branch'}, then the checks run. If they fail, the merge is undone and the part goes back to its Foreman. Nothing is pushed: pushing the whole stack stays on its page.</p>
          <div className="sheet-actions">
            <Button size="lg" onClick={() => setConfirm(false)} disabled={state.sending}>Not now</Button>
            <Button kind="primary" size="lg" busy={state.sending} data-autofocus onClick={async () => { if (await state.act('merge', { section: p.name })) setConfirm(false); }}>Merge part {p.n}</Button>
          </div>
        </Sheet>
      )}
      {file && <DiffSheet file={file} state={state} onClose={() => setFile(null)} />}
      {levelOpen && job && <LevelSheet n={p.n} job={job} detail={jobDetail} onClose={() => setLevelOpen(false)} />}
    </Page>
  );
}

const linkList = (page: PartPageData, ns: number[] | undefined, none: string) => (ns?.length ? (
  <span className="part-links">{ns.map((n) => {
    const x = page.stack.parts.find((q) => q.n === n);
    const look = x ? LANE_LOOK[x.lane] : null;
    return <a key={n} className="part-link" href={partHref(page.stack.slug, n)} title={x ? `${x.title}: ${x.laneWords}` : undefined}>{look && <Icon name={look.icon} size={12} className={`tone-${look.tone} part-link-icon`} />}Part {n}{x ? <span className="part-link-name"> · {x.title}</span> : null}</a>;
  })}</span>
) : <span className="muted">{none}</span>);

/** What this part is for, what it waits on and unblocks, its files, branch and port. */
function ContextStrip({ page, level }: { page: PartPageData; level: ReactNode }) {
  const p = page.part;
  const [owns, setOwns] = useState(false);
  return (
    <section className="part-context" aria-label="Its place in the stack">
      {p.brief && <p className="part-for"><span className="eyebrow">For</span> {p.brief}</p>}
      <dl className="part-context-facts">
        <div><dt>Waits on</dt><dd>{linkList(page, p.dependsOnN, 'Nothing')}</dd></div>
        <div><dt>Unblocks</dt><dd>{linkList(page, p.unblocks, 'No other part')}</dd></div>
        <div>
          <dt>Owns</dt>
          <dd><button type="button" className="part-owns-toggle" aria-expanded={owns} onClick={() => setOwns((o) => !o)} title={owns ? 'Hide the paths it may change.' : 'Show the paths it may change.'}>{p.owns.length} {p.owns.length === 1 ? 'path' : 'paths'} <Icon name="chevron-down" size={12} /></button></dd>
        </div>
        {p.branch && <div><dt>Branch</dt><dd className="part-mono">{p.branch}</dd></div>}
        {p.port && <div><dt>Port</dt><dd className="num">{p.port}</dd></div>}
        {(p.costUsd ?? 0) > 0 && <div><dt>Claude cost</dt><dd className="num">{money(p.costUsd)}</dd></div>}
        {level}
      </dl>
      {owns && <ul className="part-owns">{p.owns.map((o) => <li key={o} className="part-mono">{o}</li>)}</ul>}
    </section>
  );
}

/** The stack's problem with this part, in its own designed state with one action. */
function PartProblemBar({ page, state, canMerge, onMerge }: { page: PartPageData; state: PartState; canMerge: boolean; onMerge: () => void }) {
  const p = page.part;
  const clash = page.risks?.find((r) => r.kind === 'clash')?.words ?? null;
  const fix = () => void state.act('send-back', { section: p.name });
  if (p.state === 'failed') {
    return <NextBar tone="stop" icon="hand" say={`Part ${p.n} got stuck`} sub={`Its tests failed ${p.failures || 3} times after merging, and each time the merge was undone. Its Foreman stopped to ask you.`}><Button size="lg" kind="primary" busy={state.sending} onClick={fix} title="Send it back to its Foreman to try again, with what failed.">Let the Foreman try again</Button></NextBar>;
  }
  if (p.state === 'blocked' && p.problem) {
    const k = p.problem.kind;
    const files = (p.problem.files ?? []).map((f) => f.split('/').pop()).join(', ');
    const say = k === 'conflict' ? clash ?? `Part ${p.n} clashes at its merge` : k === 'outside' ? `Part ${p.n} changed files that aren’t its own` : k === 'empty' ? `Part ${p.n} has nothing to merge yet` : `Part ${p.n} came back from its merge`;
    const sub = k === 'conflict' ? `Both changed ${files || 'the same files'}. Nothing was merged: the stack’s branch is as it was.` : k === 'outside' ? `${files}. Nothing was merged: each part may change only its own files.` : k === 'empty' ? 'Its branch has no new commits. Nothing was merged.' : p.problem.words;
    return <NextBar tone="stop" icon="warn" say={say} sub={sub} className="stack-bar-problem"><Button size="lg" kind="primary" busy={state.sending} onClick={fix} title="Send it back to its Foreman with what went wrong.">Let the Foreman fix it</Button></NextBar>;
  }
  if (p.problem?.kind === 'checks') {
    return <NextBar tone="warn" icon="refresh" say={`Tests failed after merging part ${p.n}, so it was undone`} sub={`The stack’s branch is back where it was. Its Foreman has what failed and is fixing it (try ${p.failures} of 3).`} className="stack-bar-problem" />;
  }
  if (canMerge) {
    return <NextBar tone="go" icon="merge" label="Go / no go" say={`Part ${p.n} is ready to merge`} sub="Its checks passed and it is next in order. The checks run again after merging."><Button size="lg" kind="primary" busy={state.sending} onClick={onMerge} title="Merge it into the stack’s branch, then run the checks. Asks first.">Merge part {p.n}</Button></NextBar>;
  }
  return null;
}

/** The part's own job's next step: the go / no go bar when it waits for you (the Job page's). */
function JobNext({ job, now }: { job: Job; now: Date }) {
  const conversation = useJobConversation(job);
  useCurrentJob(job, conversation);
  return <NextStep job={job} conversation={conversation} now={now} />;
}

/**
 * The job's level, in the context strip: the chosen one, or "Not chosen yet", and "Choose" when
 * the level card has something to offer (no level yet, or the Foreman suggests another).
 */
function LevelFact({ job, detail, onChoose }: { job: Job; detail: JobDetail | null; onChoose: () => void }) {
  const { meta } = useWorkshopState();
  const facts = levelFacts(job, detail);
  const [dismissed] = useStored(levelCardKey(job.slug));
  const view = levelCardView(facts, dismissed);
  const chosen = isLevel(facts.level) ? facts.level : null;
  const offer = view.show && view.target !== null;
  return (
    <div className="part-level">
      <dt>Level</dt>
      <dd>
        <span>{chosen === null ? 'Not chosen yet' : levelLabel(chosen, meta?.levels)}</span>
        {offer && (
          <>
            <span className="part-level-sep" aria-hidden="true">·</span>
            <Button kind="quiet" size="sm" className="part-level-choose" onClick={onChoose} title={chosen === null ? 'Pick how much process this part’s job gets: the rules’ and the Foreman’s suggestions, side by side.' : `The Foreman suggests L${view.target}. See both suggestions and choose.`}>
              {chosen === null ? 'Choose' : `Foreman suggests L${view.target} · Review`}
            </Button>
          </>
        )}
      </dd>
    </div>
  );
}

/** The level card in a sheet of its own. "Not now" or "Keep" closes it; after "Use" it says what changed. */
function LevelSheet({ n, job, detail, onClose }: { n: number; job: Job; detail: JobDetail | null; onClose: () => void }) {
  const [dismissed] = useStored(levelCardKey(job.slug));
  const opened = useRef(dismissed);
  useEffect(() => { if (dismissed !== opened.current) onClose(); }, [dismissed, onClose]);
  return (
    <Sheet title={`The level for part ${n}’s job`} onClose={onClose} className="part-level-sheet">
      <LevelCard job={job} detail={detail} />
      <div className="sheet-actions"><Button size="lg" onClick={onClose} data-autofocus>Close</Button></div>
    </Sheet>
  );
}

function Conversation({ job, now, wide, onDetail }: { job: Job; now: Date; wide: boolean; onDetail: (d: JobDetail | null) => void }) {
  const conversation = useJobConversation(job);
  const n = conversation.thread.items.length;
  const detail = conversation.thread.detail;
  useEffect(() => { onDetail(detail); }, [detail, onDetail]);
  return (
    <section className="job-convo part-convo" aria-label="Conversation">
      <header className="job-side-head"><Icon name="message" size={16} /><h3>Conversation with its Foreman</h3>{n > 0 && <span className="muted">· {n} {n === 1 ? 'message' : 'messages'}</span>}</header>
      <div className="job-convo-thread"><ThreadList job={job} conversation={conversation} now={now} cards={false} level={false} newest={wide ? undefined : 1} /></div>
      <Composer key={job.slug} slug={job.slug} detail={conversation.thread.detail} run={conversation.run} />
    </section>
  );
}

const KIND: Record<string, { group: string; icon: 'merge' | 'flask' | 'warn' | 'loader' | 'circle-check' }> = {
  started: { group: 'Starts', icon: 'loader' },
  'start-failed': { group: 'Starts', icon: 'warn' },
  ready: { group: 'Checks', icon: 'circle-check' },
  'merge-started': { group: 'Merges', icon: 'merge' },
  merged: { group: 'Merges', icon: 'merge' },
  conflict: { group: 'Problems', icon: 'warn' },
  outside: { group: 'Problems', icon: 'warn' },
  empty: { group: 'Problems', icon: 'warn' },
  'checks-failed': { group: 'Checks', icon: 'flask' },
  stuck: { group: 'Problems', icon: 'warn' },
  'merge-refused': { group: 'Problems', icon: 'warn' },
  'sent-back': { group: 'Starts', icon: 'loader' },
};

/** The part's history, grouped by kind with a count, folded. */
function History({ page, now }: { page: PartPageData; now: Date }) {
  const h = page.history;
  const groups = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of h) { const g = KIND[e.event]?.group ?? 'Other'; m.set(g, (m.get(g) ?? 0) + 1); }
    const one: Record<string, string> = { Starts: 'start', Merges: 'merge try', Checks: 'check', Problems: 'problem', Other: 'other' };
    const many: Record<string, string> = { Starts: 'starts', Merges: 'merge tries', Checks: 'checks', Problems: 'problems', Other: 'others' };
    return [...m.entries()].map(([g, c]) => `${c} ${c === 1 ? one[g] : many[g]}`).join(', ');
  }, [h]);
  return (
    <More screen="part" id="history" label="Activity" count={h.length} note={groups || 'nothing yet'} icon="activity" className="is-card part-history">
      {h.length ? (
        <ol className="part-history-list">
          {h.map((e, i) => (
            <li key={`${e.at}-${i}`} className={`ph-${e.event}`}>
              <Icon name={KIND[e.event]?.icon ?? 'circle'} size={14} />
              <span className="ph-words">{e.words}</span>
              <time className="muted num" dateTime={e.at} title={new Date(e.at).toLocaleString()}>{relativeTime(e.at, now)}</time>
            </li>
          ))}
        </ol>
      ) : <p className="muted">Nothing has happened to it yet. Its start, merges and checks land here.</p>}
    </More>
  );
}

function Changes({ page, onOpen }: { page: PartPageData; onOpen: (file: string) => void }) {
  const c = page.changes;
  const max = Math.max(1, ...c.files.map((f) => f.added + f.removed));
  return (
    <section className="part-card" aria-label="Changes">
      <header className="part-card-head">
        <Icon name="code" size={16} /><h3>Changes</h3>
        {c.files.length > 0 && <span className="muted num">· {c.files.length} {c.files.length === 1 ? 'file' : 'files'}</span>}
        <span className="spacer" />
        {c.files.length > 0 && <span className="num part-plusminus"><span className="is-add">+{c.added}</span> <span className="is-del">−{c.removed}</span></span>}
      </header>
      {c.error ? <p className="part-card-note muted">{c.error}</p> : !c.files.length ? <p className="part-card-note muted">No changes against {c.base ?? 'the stack’s branch'} yet.</p> : (
        <ul className="part-files">
          {c.files.map((f) => (
            <li key={f.file}>
              <button type="button" className="part-file" onClick={() => onOpen(f.file)} title={`Show the changes to ${f.file}, against ${c.base ?? 'the stack’s branch'}.`}>
                <span className="part-file-name"><span className="part-file-dir">{f.file.includes('/') ? `${f.file.slice(0, f.file.lastIndexOf('/') + 1)}` : ''}</span>{f.file.split('/').pop()}</span>
                {f.binary ? <span className="muted">binary</span> : <span className="num part-plusminus"><span className="is-add">+{f.added}</span> <span className="is-del">−{f.removed}</span></span>}
                <span className="part-file-bar" aria-hidden="true"><i className="is-add" style={{ width: `${(f.added / max) * 100}%` }} /><i className="is-del" style={{ width: `${(f.removed / max) * 100}%` }} /></span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Checks({ page, now }: { page: PartPageData; now: Date }) {
  const p = page.part;
  const last = page.history.find((e) => e.event === 'merged' || e.event === 'checks-failed' || e.event === 'conflict' || e.event === 'stuck');
  const tries = page.history.filter((e) => e.event === 'checks-failed').length;
  const [tail, setTail] = useState(false);
  return (
    <section className="part-card" aria-label="Checks">
      <header className="part-card-head"><Icon name="flask" size={16} /><h3>Checks</h3><span className="spacer" />{tries > 0 && <span className="muted num">{tries} failed {tries === 1 ? 'try' : 'tries'} of 3</span>}</header>
      {!last ? (
        <p className="part-card-note muted">{p.state === 'ready' ? 'Its own checks passed. The stack’s checks run again when it merges.' : 'The checks run on the stack’s branch when it merges. Nothing has run yet.'}</p>
      ) : (
        <div className="part-check">
          <p className={`part-check-line ${last.event === 'merged' ? 'is-ok' : 'is-bad'}`}>
            <Icon name={last.event === 'merged' ? 'circle-check' : 'warn'} size={16} />
            <span>{last.event === 'merged' ? 'Passed after its merge' : last.event === 'conflict' ? 'Didn’t run: the merge clashed' : last.event === 'stuck' ? 'Failed three times: stopped' : 'Failed after its merge, so the merge was undone'}</span>
            <time className="muted num" dateTime={last.at}>{relativeTime(last.at, now)}</time>
          </p>
          {last.checks?.length ? <ul className="part-check-list">{last.checks.map((c) => <li key={c.command} className={c.ok ? 'is-ok' : 'is-bad'}><Icon name={c.ok ? 'check' : 'x'} size={12} /><code>{c.command}</code> {c.ok ? 'passed' : 'failed'}</li>)}</ul> : null}
          {p.problem?.tail && (
            <>
              <Button kind="quiet" size="sm" onClick={() => setTail((t) => !t)} aria-expanded={tail} title="The end of the failed checks’ output.">{tail ? 'Hide what failed' : 'See what failed'}</Button>
              {tail && <pre className="stack-tail">{p.problem.tail}</pre>}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function Checklist({ page, canMerge, busy, onMerge }: { page: PartPageData; canMerge: boolean; busy: boolean; onMerge: () => void }) {
  const p = page.part;
  const merged = p.state === 'integrated';
  return (
    <section className="part-card" aria-label="Ready to merge">
      <header className="part-card-head"><Icon name="merge" size={16} /><h3>{merged ? 'Merged' : 'Ready to merge'}</h3><span className="spacer" />{merged && p.mergedAt && <span className="muted num">{new Date(p.mergedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>}</header>
      <ul className="part-checklist">
        {page.checklist.map((c) => (
          <li key={c.id} className={c.ok === true ? 'is-ok' : c.ok === false ? 'is-bad' : 'is-open'}>
            <Icon name={c.ok === true ? 'circle-check' : c.ok === false ? 'warn' : 'circle-dashed'} size={16} />
            <span>{c.words}</span>
            <span className="sr-only">{c.ok === true ? 'done' : c.ok === false ? 'not met' : 'not yet known'}</span>
          </li>
        ))}
      </ul>
      {!merged && (
        <footer className="part-card-foot">
          <span className="muted">{canMerge ? 'Every check is met. Merging asks first.' : 'Merge opens when every line is met and it is next in order.'}</span>
          <Button kind={canMerge ? 'primary' : 'secondary'} disabled={!canMerge} busy={busy} onClick={onMerge} title={canMerge ? 'Merge it into the stack’s branch, then run the checks. Asks first.' : 'Not yet: see the lines above.'}>Merge part {p.n}</Button>
        </footer>
      )}
    </section>
  );
}

/** One file's diff against the stack's branch, read-only. */
function DiffSheet({ file, state, onClose }: { file: string; state: PartState; onClose: () => void }) {
  const [d, setD] = useState<{ diff?: string; cut?: boolean; error?: string } | null>(null);
  useEffect(() => { let on = true; void state.diff(file).then((r) => { if (on) setD(r); }); return () => { on = false; }; }, [file, state]);
  const lines = (d?.diff ?? '').split('\n').filter((l, i) => i > 3 || !/^(diff --git|index |--- |\+\+\+ )/.test(l));
  return (
    <Sheet title={file} onClose={onClose} className="part-diff-sheet">
      {!d ? <Pending loading say="Reading the changes…" skeleton={<Skeleton rows={8} className="part-diff-skeleton" />} /> : d.error ? <p className="field-problem">{d.error}</p> : (
        <>
          <pre className="part-diff" aria-label={`Changes to ${file}`}>{lines.map((l, i) => <span key={i} className={l.startsWith('+') ? 'is-add' : l.startsWith('-') ? 'is-del' : l.startsWith('@@') ? 'is-hunk' : ''}>{l || ' '}{'\n'}</span>)}</pre>
          {d.cut && <p className="muted">The diff is long, so only its first part is shown.</p>}
        </>
      )}
      <div className="sheet-actions"><Button size="lg" onClick={onClose} data-autofocus>Close</Button></div>
    </Sheet>
  );
}
