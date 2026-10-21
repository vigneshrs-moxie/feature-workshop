// The flow map (Home): one section per repo, one lane per job, left to right the way its work
// travels: your worktree → your fork → PR #1 → the Moxie branch → PR #2 → staging → the release PR
// → main (dashboard/lib/flow.js). Staging and main are tall boxes every lane of the repo flows into.
// A repo without an org remote or a staging branch draws the short flow: worktree → fork → PR → main.
//
// Each lane is a list item; its boxes say in words where the work is and what each PR is doing,
// so nothing depends on colour or on the arrows. The box the work has reached is marked "Here".
// Clicking a job opens it; clicking a PR opens it on GitHub.
import type { CSSProperties } from 'react';
import type { FlowLane, FlowPr, FlowRepo, Job } from '../api/types';
import { jobHref } from '../app/router';
import { relativeTime } from '../lib/time';
import { jobStatus } from '../panes/Jobs/jobStatus';
import { stageLabel } from '../panes/Jobs/stages';
import { CrewMember } from '../play/CrewMember';
import { useTrail } from '../play/useTrail';
import { jobHueStyle } from '../theme/hue';
import { countsText, countsWords, type MapRepo, POSITION_LABELS, prText, prTone, whereText } from './homeModel';

const ORDER = ['local', 'fork', 'org', 'staging', 'main'] as const;

function boxState(lane: FlowLane, at: (typeof ORDER)[number]): 'is-here' | 'is-passed' | 'is-ahead' {
  const i = ORDER.indexOf(at);
  return i === lane.reached ? 'is-here' : i < lane.reached ? 'is-passed' : 'is-ahead';
}

function LaneCrew({ job, now }: { job: Job; now: Date }) {
  const trail = useTrail(job, now, 'card');
  if (!trail) return null;
  return (
    <span className="lane-crew" aria-hidden="true">
      <CrewMember type={trail.who} state={trail.mood} size={36} label="" animated={false} />
      {trail.ask && <span className="row-crew-ask">!</span>}
    </span>
  );
}

function PrArrow({ pr, label, reached }: { pr: FlowPr | null; label: string; reached: boolean }) {
  const tone = prTone(pr);
  return (
    <div className={`flow-arrow${reached ? ' is-reached' : ''}`}>
      <span className="flow-arrow-line" aria-hidden="true" />
      {!pr ? <span className="sr-only">{label}: not opened yet.</span> : pr.url ? (
        <a className={`flow-pr is-${tone}`} href={pr.url} target="_blank" rel="noreferrer" title={`${label}: ${pr.title || prText(pr)}. Opens on GitHub.`}>
          <span className="flow-pr-label">{label}</span> {prText(pr)}
        </a>
      ) : (
        <span className={`flow-pr is-${tone}`} title={pr ? `${label}: ${prText(pr)}` : `${label}: not opened yet.`}>
          <span className="flow-pr-label">{label}</span> {prText(pr)}
        </span>
      )}
    </div>
  );
}

function JobBox({ lane, job, now }: { lane: FlowLane; job: Job | null; now: Date }) {
  const status = job ? jobStatus(job, now) : null;
  const title = job?.title || lane.title || lane.slug;
  return (
    <div className="flow-box flow-job" data-group={status?.group}>
      <div className="flow-job-head">
        {job && <LaneCrew job={job} now={now} />}
        <span className="hue-dot" style={jobHueStyle(lane.slug)} aria-hidden="true" />
        <a className="flow-job-title" href={jobHref(lane.slug)} title={`Open ${title}.`}>{title}</a>
        {status && (
          <span className={`job-status status-${status.group}`} title={status.hint}>
            <span className={`glyph status-${status.group}`} aria-hidden="true">{status.glyph}</span>
            <span className="job-status-label">{status.label}</span>
          </span>
        )}
        {job?.stage && <span className="stage-chip">{stageLabel(job.stage)}</span>}
      </div>
      <div className="flow-counts">
        {lane.branch && <code className="flow-branch" title={lane.worktree ? `Worktree: ${lane.worktree}` : 'No worktree on this machine'}>{lane.branch}</code>}
        {lane.vsMain && (
          <span className={`flow-count${lane.vsMain.behind > 0 ? ' is-behind' : ''}`} title={countsWords(lane.vsMain, 'main')}>
            main {countsText(lane.vsMain)}
          </span>
        )}
        {lane.unpushed ? <span className="flow-count is-note" title="Commits in the worktree that your fork doesn’t have yet.">{lane.unpushed} not pushed</span> : null}
        {lane.dirty ? <span className="flow-count is-note" title="Files changed in the worktree but not committed.">{lane.dirty} uncommitted</span> : null}
      </div>
    </div>
  );
}

function Lane({ lane, job, repo, now, row }: { lane: FlowLane; job: Job | null; repo: FlowRepo; now: Date; row: number }) {
  const simple = !repo.org || !repo.staging;
  const style = { '--row': row } as CSSProperties;
  const title = job?.title || lane.title || lane.slug;
  return (
    <li className="flow-lane" aria-label={`${title}: ${whereText(lane, repo)}`} style={style}>
      <JobBox lane={lane} job={job} now={now} />
      <div className="flow-arrow is-plain" aria-hidden="true"><span className="flow-arrow-line" /></div>
      <div className={`flow-box flow-step ${boxState(lane, 'fork')}`}>
        <span className="sr-only">{POSITION_LABELS.fork}: </span>
        <span className="flow-step-what">{lane.pushed ? (lane.unpushed ? `Pushed, ${lane.unpushed} behind` : 'Pushed') : 'Not pushed yet'}</span>
      </div>
      {simple ? (
        <PrArrow pr={lane.pr2} label="PR" reached={lane.reached >= ORDER.indexOf('main')} />
      ) : (
        <>
          <PrArrow pr={lane.pr1} label="PR #1" reached={lane.reached >= ORDER.indexOf('org')} />
          <div className={`flow-box flow-step ${boxState(lane, 'org')}`}>
            <span className="sr-only">{POSITION_LABELS.org}: </span>
            <span className="flow-step-what">{lane.orgBranch || lane.reached >= 2 ? <code>{repo.org?.remote}/{lane.branch}</code> : 'Not there yet'}</span>
          </div>
          <PrArrow pr={lane.pr2} label="PR #2" reached={lane.reached >= ORDER.indexOf('staging')} />
        </>
      )}
    </li>
  );
}

function SharedBox({ kind, repo, lanes, rows, column }: { kind: 'staging' | 'main'; repo: FlowRepo; lanes: FlowLane[]; rows: number; column: string }) {
  const here = lanes.filter((l) => l.position === kind);
  const tip = kind === 'staging' ? repo.staging?.tip : repo.main?.tip;
  const style = { gridColumn: column, gridRow: `2 / span ${rows}` } as CSSProperties;
  return (
    <div className={`flow-box flow-shared flow-${kind}${here.length ? ' is-here' : ''}`} style={style}>
      <span className="flow-step-name">{POSITION_LABELS[kind]}</span>
      <code className="flow-branch">{kind === 'staging' ? repo.staging?.ref : repo.main?.ref}</code>
      {kind === 'staging' && repo.staging?.vsMain && (
        <span className="flow-step-what" title="Commits in staging that main doesn’t have yet: they go out with the next release.">
          {repo.staging.vsMain.ahead} commit{repo.staging.vsMain.ahead === 1 ? '' : 's'} waiting for release
        </span>
      )}
      {tip && <span className="flow-tip muted" title={tip.subject}>Last: {tip.subject} · {relativeTime(tip.at)}</span>}
      {here.length > 0 && (
        <ul className="flow-here" aria-label={`Jobs in ${kind}`}>
          {here.map((l) => <li key={l.slug}><a href={jobHref(l.slug)}>{l.title || l.slug}</a></li>)}
        </ul>
      )}
    </div>
  );
}

export function FlowMap({ repos, now }: { repos: MapRepo[]; now: Date }) {
  return (
    <div className="flow-map">
      {repos.map(({ repo, lanes }) => {
        const simple = !repo.org || !repo.staging;
        const headId = `flow-${repo.name}`;
        const rows = lanes.length;
        return (
          <section key={repo.repo} className="flow-repo" aria-labelledby={headId}>
            <header className="flow-repo-head">
              <h3 id={headId}>{repo.name}</h3>
              <span className="muted flow-remotes">
                {repo.fork?.slug && <span title={`Your fork (${repo.fork.remote})`}>fork {repo.fork.slug}</span>}
                {repo.org?.slug && <span title={`The org repo (${repo.org.remote})`}>org {repo.org.slug}</span>}
              </span>
              {!repo.prsKnown && <span className="flow-warn" title="The PRs haven’t been read yet (the first refresh may still be running, or the gh command isn’t signed in).">PRs not read yet</span>}
              {repo.errors.length > 0 && <span className="flow-warn" title={repo.errors.join('\n')}>Couldn’t refresh everything</span>}
            </header>
            <div className="flow-scroll">
              <ol className={`flow-grid${simple ? ' is-simple' : ''}`} aria-label={`Jobs in ${repo.name}`}>
                <li className="flow-cols" aria-hidden="true">
                  <span style={{ gridColumn: '1' }}>Job · your worktree</span>
                  <span style={{ gridColumn: '3' }}>Your fork</span>
                  {simple ? <span style={{ gridColumn: '5' }}>Main</span> : (
                    <>
                      <span style={{ gridColumn: '5' }}>Moxie branch</span>
                      <span style={{ gridColumn: '7' }}>Staging</span>
                      <span style={{ gridColumn: '9' }}>Main</span>
                    </>
                  )}
                </li>
                {lanes.map(({ lane, job }, i) => <Lane key={lane.slug} lane={lane} job={job} repo={repo} now={now} row={i + 2} />)}
                <li className="flow-shared-cell" style={{ display: 'contents' }}>
                  {simple ? (
                    <SharedBox kind="main" repo={repo} lanes={lanes.map((l) => l.lane)} rows={rows} column="5" />
                  ) : (
                    <>
                      <SharedBox kind="staging" repo={repo} lanes={lanes.map((l) => l.lane)} rows={rows} column="7" />
                      <div className={`flow-arrow flow-release${repo.release ? ' has-pr' : ''}`} style={{ gridColumn: '8', gridRow: `2 / span ${rows}` } as CSSProperties}>
                        <span className="flow-arrow-line" aria-hidden="true" />
                        {repo.release?.url ? (
                          <a className={`flow-pr is-${prTone(repo.release)}`} href={repo.release.url} target="_blank" rel="noreferrer" title="The release PR: staging → main. Opens on GitHub.">
                            <span className="flow-pr-label">Release</span> {prText(repo.release)}
                          </a>
                        ) : <span className="flow-pr is-none"><span className="flow-pr-label">Release</span> none open</span>}
                      </div>
                      <SharedBox kind="main" repo={repo} lanes={lanes.map((l) => l.lane)} rows={rows} column="9" />
                    </>
                  )}
                </li>
              </ol>
            </div>
          </section>
        );
      })}
    </div>
  );
}
