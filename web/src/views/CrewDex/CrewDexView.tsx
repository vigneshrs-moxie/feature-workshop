// The Crew-dex (#/crew, Play mode only): a numbered card per crew member, #001–#015, with their
// character, name, role, model and rarity, and what they have done on this computer (GET /api/play:
// jobs worked, times dispatched, blockers and majors raised as a review lens, average time on a
// stage, last seen). A member you haven't met yet is a silhouette with no stats. A card you have met
// flips (click it, or its "Card back" button) to a short bio. In Full mode a character gets to work
// while you point at or focus its card; Subtle keeps them still. The header counts crew met, secrets
// found (never which) and achievements (a link to the Achievements view). Everything is local: no
// model is asked anything.
import { useState } from 'react';
import type { CrewStats, Meta, PlayView } from '../../api/types';
import { achievementsHref } from '../../app/router';
import { HowThisWorks } from '../../components/HowThisWorks';
import { fullTime, relativeTime, useNow } from '../../lib/time';
import { CREW, crewModelName, crewRarity, dexNumber, isLensType, RARITY_HINT, RARITY_LABEL, type CrewInfo } from '../../play/crew';
import { CrewMember } from '../../play/CrewMember';
import { usePlay, type PlayState } from '../../play/usePlay';
import { usePlayLedger } from '../../play/usePlayLedger';
import { useWorkshopState } from '../../state/store';

const MIN = 60_000;

/** "under a minute", "38m", "1h 12m". */
export function stageTime(ms: number): string {
  if (ms < MIN) return 'under a minute';
  const m = Math.round(ms / MIN);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`;
}

function lastSeen(iso: string, now: Date): string {
  const rel = relativeTime(iso, now);
  return /^\d+[mhd]$/.test(rel) ? `${rel} ago` : rel;
}

function Stats({ member, stats, now }: { member: CrewInfo; stats: CrewStats; now: Date }) {
  const foreman = member.type === 'conductor';
  return (
    <dl className="dex-stats">
      <div title={foreman ? 'Jobs any of the crew worked on, on this computer.' : 'Jobs they worked on, on this computer.'}>
        <dt>Jobs worked</dt><dd className="num">{stats.jobs}</dd>
      </div>
      <div title={foreman ? 'How many times the Foreman handed work to a crew member.' : 'How many times the Foreman handed them work.'}>
        <dt>{foreman ? 'Work handed out' : 'Times dispatched'}</dt><dd className="num">{stats.dispatches}</dd>
      </div>
      {isLensType(member.type) && (
        <>
          <div title="Blockers this reviewer raised, from the jobs’ review.md (the most per job, over every round).">
            <dt>Blockers raised</dt><dd className="num">{stats.blockers}</dd>
          </div>
          <div title="Majors this reviewer raised, from the jobs’ review.md (the most per job, over every round).">
            <dt>Majors raised</dt><dd className="num">{stats.majors}</dd>
          </div>
        </>
      )}
      {!foreman && (
        <div title="How long one of their stages takes on average, from the session logs.">
          <dt>Avg. time on a stage</dt><dd className="num">{stats.avgStageMs === null ? 'not recorded yet' : stageTime(stats.avgStageMs)}</dd>
        </div>
      )}
      <div title={fullTime(stats.lastSeen)}>
        <dt>Last seen</dt><dd className="num">{lastSeen(stats.lastSeen, now)}</dd>
      </div>
    </dl>
  );
}

function DexCard({ member, stats, meta, play, now }: { member: CrewInfo; stats: CrewStats | undefined; meta: Meta | null; play: PlayState; now: Date }) {
  const met = Boolean(stats);
  const [flipped, setFlipped] = useState(false);
  const [active, setActive] = useState(false); // pointed at or focused: Full mode puts them to work
  const rarity = crewRarity(member.type, meta?.crewModels);
  const model = crewModelName(member.type, meta);
  const effort = member.type === 'conductor' ? null : meta?.crewModels?.[member.type]?.effort ?? null;
  const number = dexNumber(member.number);
  const back = met && flipped;
  const toggle = () => { if (met) setFlipped((f) => !f); };
  return (
    <li
      className={`dex-card rarity-${rarity} ${met ? 'is-met' : 'is-unmet'}${back ? ' is-flipped' : ''}`}
      data-crew={member.type}
      onClick={toggle}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      onFocus={() => setActive(true)}
      onBlur={() => setActive(false)}
    >
      <div className="dex-card-inner">
        <div className="dex-face dex-front" aria-hidden={back || undefined} inert={back || undefined}>
          <div className="dex-card-top">
            <span className="dex-no num">{number}</span>
            <span className={`chip dex-rarity rarity-${rarity}`} title={RARITY_HINT[rarity]}>{RARITY_LABEL[rarity]}</span>
          </div>
          <div className="dex-portrait">
            <CrewMember type={member.type} state={met && active && play.animated ? 'working' : 'idle'} size={76} label="" silhouette={!met} />
          </div>
          <h3 className="dex-name">{member.name}</h3>
          <p className="dex-role muted">{member.role}</p>
          <p className="dex-model" title={member.type === 'conductor' ? 'The Foreman runs on Opus at every level, unless you pick another model for a job.' : 'The model their agent file names.'}>
            {model}{effort ? ` · effort ${effort}` : ''}
          </p>
          {met && stats ? (
            <Stats member={member} stats={stats} now={now} />
          ) : (
            <p className="dex-unmet-note" title="They join your Crew-dex the first time they work on one of your jobs on this computer.">Not met yet</p>
          )}
        </div>
        {met && (
          <div className="dex-face dex-back" aria-hidden={!back || undefined} inert={!back || undefined}>
            <span className="dex-no num">{number}</span>
            <p className="dex-name">{member.name}</p>
            <blockquote className="dex-bio">{member.bio}</blockquote>
            {stats && <p className="dex-first muted">First met {fullTime(stats.firstSeen)}</p>}
          </div>
        )}
      </div>
      {met && (
        <button
          type="button"
          className="btn btn-quiet dex-flip"
          aria-pressed={back}
          aria-label={`${member.name}: card back`}
          title={back ? 'Turn the card back to the front.' : `Turn the card over to read ${member.name}’s bio.`}
          onClick={(e) => { e.stopPropagation(); toggle(); }}
        >
          {/* A toggle: while the back shows it looks pressed (and ticked), so its name never changes. */}
          {back && <span aria-hidden="true">✓ </span>}Card back
        </button>
      )}
    </li>
  );
}

function Counts({ view }: { view: PlayView }) {
  const visible = view.achievements.filter((a) => !a.secret);
  const got = visible.filter((a) => a.unlockedAt).length;
  return (
    <ul className="dex-counts" aria-label="Your collection">
      <li title="Crew members you have met: each one the first time they worked on one of your jobs on this computer.">
        Crew met <strong className="num">{view.crewMet}/{view.crewTotal}</strong>
      </li>
      <li title="A few secrets are hidden around the Workshop. This only says how many you have found.">
        Secrets found <strong className="num">{view.secrets.found.length}/{view.secrets.total}</strong>
      </li>
      <li className="dex-achievements">
        <a href={achievementsHref()} title="Achievements you have unlocked by finishing work (never by approving). Open the full list.">
          Achievements <strong className="num">{got}/{visible.length}</strong>
        </a>
      </li>
    </ul>
  );
}

export function CrewDexView() {
  const play = usePlay();
  const { meta } = useWorkshopState();
  const { load, retry } = usePlayLedger();
  const now = useNow();
  return (
    <main className="pane pane-foreman" data-pane="crew" aria-label="Crew-dex">
      <div className="foreman-column crew-dex">
        <h2 className="pane-title">Crew-dex</h2>
        <HowThisWorks id="crew-dex">
          <p><strong>The crew</strong> are the helpers the Foreman hands work to: the Scribe writes the spec, the Sleuth investigates the code, the Draftsman plans, the Builder builds, the Tester runs the checks, the Head inspector and seven specialist reviewers look at the change, and the Oracle takes Fable’s second look. Each card shows their number, job, the model they run on and how rare that model is (Haiku common, Sonnet uncommon, Opus rare, Fable legendary).</p>
          <p><strong>You meet someone</strong> the first time they actually work on one of your jobs on this computer; until then they are a silhouette. Approving something never meets anyone. Click a card you have met (or its <strong>Card back</strong> button) to turn it over and read their bio.</p>
          <p>The stats come from what the dashboard already records (its log, the session logs and each job’s review.md). It is personal: nothing is shared, Claude is never asked anything and it costs no usage. There are also a few secrets hidden around the Workshop; the counter says how many you have found, not where.</p>
        </HowThisWorks>
        {load.state === 'loading' && <p className="muted">Loading the Crew-dex…</p>}
        {/* The dashboard answered that Play is Off before this page heard (another tab turned it off). */}
        {load.state === 'off' && <p className="muted" role="status">Play mode is Off, so the Crew-dex is put away. Turn Play back on in Settings to see it.</p>}
        {load.state === 'error' && (
          <p className="thread-error" role="alert">
            Couldn’t load the Crew-dex: {load.message}{' '}
            <button type="button" className="btn btn-quiet" onClick={retry} title="Ask the dashboard again.">Try again</button>
          </p>
        )}
        {load.state === 'ready' && (
          <>
            <Counts view={load.view} />
            <ol className="dex-grid">
              {CREW.map((m) => <DexCard key={m.type} member={m} stats={load.view.crew[m.type]} meta={meta} play={play} now={now} />)}
            </ol>
          </>
        )}
      </div>
    </main>
  );
}
