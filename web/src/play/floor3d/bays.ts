// What kind of bay a job is on the station, and how far its work has got (packet SB). Pure: no
// React, no three.js, no fetching.
//
// A feature is a construction bay: a new module grows in a scaffold, stage by stage. A bug fix is
// a repair dock: a craft with a damaged panel sits in a dry dock until it is mended. The kind comes
// from the job card's `kind` (dashboard/lib/features.js kindFor: status.json, else a guess from the
// branch or slug); a stack's parts are features. Shape tells them apart first, then the sign's
// icon and words, then colour.
//
//   stage                         phase      construction bay              repair dock
//   spec, investigate, plan       frame      "frame going up"              "damage found"
//   build (implement)             plates     "hull plates going on"        "repair under way"
//   test                          lights     "lights coming on"            "testing the repair"
//   review, the PRs               sealed     "sealed and polished"         "panel clean"
//   done (or past the finish)     launched   "launched"                    "undocked"
import type { Job } from '../../api/types';
import { stopOf } from '../../components/stops/stops';

export type BayKind = 'build' | 'repair';
export const BAY_KINDS: readonly BayKind[] = ['build', 'repair'];

export type BuildPhase = 'frame' | 'plates' | 'lights' | 'sealed' | 'launched';
export const PHASES: readonly BuildPhase[] = ['frame', 'plates', 'lights', 'sealed', 'launched'];

/** A bug fix is a repair dock; everything else (a feature, a stack and its parts) a construction bay. */
export function bayKind(job: Pick<Job, 'kind'>): BayKind {
  return String(job.kind ?? '').toLowerCase() === 'bug' ? 'repair' : 'build';
}

/** How far the module (or the repair) has got, from the job's stage. */
export function phaseFor(job: Pick<Job, 'group' | 'stage' | 'closed' | 'finish'>): BuildPhase {
  if (job.group === 'done' || job.closed || job.finish?.reached) return 'launched';
  switch (stopOf(job.stage)) {
    case 'build': return 'plates';
    case 'test': return 'lights';
    case 'review': case 'ship': return 'sealed';
    default: return 'frame';
  }
}

/** The verb on the bay's sign: "Building · Invoice export", "Repairing · Footer typo". */
export const SIGN_VERB: Record<BayKind, { working: string; finished: string }> = {
  build: { working: 'Building', finished: 'Launched' },
  repair: { working: 'Repairing', finished: 'Repaired' },
};

/** The sign's words: the verb and the job's title. */
export function signFor(kind: BayKind, phase: BuildPhase, title: string): string {
  const verb = phase === 'launched' ? SIGN_VERB[kind].finished : SIGN_VERB[kind].working;
  return `${verb} · ${title}`;
}

/** What the bay shows at each phase, in words (always beside the picture). */
export const PHASE_WORDS: Record<BayKind, Record<BuildPhase, string>> = {
  build: {
    frame: 'frame going up',
    plates: 'hull plates going on',
    lights: 'lights coming on',
    sealed: 'sealed and polished',
    launched: 'launched',
  },
  repair: {
    frame: 'damage found',
    plates: 'repair under way',
    lights: 'testing the repair',
    sealed: 'panel clean',
    launched: 'undocked',
  },
};

/** The kind in plain words, for the list and the screen reader: "Feature", "Bug fix". */
export const KIND_WORDS: Record<BayKind, string> = { build: 'Feature', repair: 'Bug fix' };

/** How many of the module's four hull sections are on at each phase (a construction bay). */
export const PLATES_ON: Record<BuildPhase, number> = { frame: 0, plates: 2, lights: 4, sealed: 4, launched: 4 };

/**
 * The bay's icons, as SVG markup on a 24-unit grid (stroked, the app's Icon style): a plus in a
 * hexagon for a construction bay, a wrench for a repair dock. Drawn on the bay's sign in 3D and
 * beside its words on the page.
 */
export const BAY_ICON: Record<BayKind, string> = {
  build: '<path d="M12 2.8 20 7.4v9.2L12 21.2 4 16.6V7.4Z"/><path d="M12 8.2v7.6M8.2 12h7.6"/>',
  repair: '<path d="M14.6 3.6a5 5 0 0 0-5.5 6.7L3.6 15.8a2 2 0 0 0 2.8 2.8l5.5-5.5a5 5 0 0 0 6.7-5.5l-3 3-2.6-.6-.6-2.6Z"/>',
};

// ---------- What a bay shows about its state (packet SB step 4) ----------

/**
 * What the bay itself signals, besides its crew's poses (always with words as well):
 *   needs-you   a slow amber beacon above the bay; the Foreman turns to you, hand up
 *   asking      a crew member holds up a card (and the beacon, since it waits on you)
 *   stuck       a red hazard light, the "!" sign, the crew sitting
 *   paused      the bay's lights dim, with a small clock (the usage limit)
 *   done        the launch or undock moment plays once; then the bay rests with "Done"
 */
export type BayAlert = 'needs-you' | 'asking' | 'stuck' | 'paused' | 'done';
export const BAY_ALERTS: readonly BayAlert[] = ['needs-you', 'asking', 'stuck', 'paused', 'done'];

export const ALERT_WORDS: Record<BayAlert, string> = {
  'needs-you': 'Needs you',
  asking: 'Asks permission',
  stuck: 'Stopped',
  paused: 'Paused for the usage limit',
  done: 'Done',
};

/** The bay's state from its status and its crew's poses: done, then paused, stuck, asking, needs you; null while it simply works. */
export function alertFor(lamp: string, poses: readonly string[]): BayAlert | null {
  if (lamp === 'done') return 'done';
  if (lamp === 'paused' || poses.includes('paused')) return 'paused';
  if (poses.includes('stuck')) return 'stuck';
  if (poses.includes('asking')) return 'asking';
  if (lamp === 'needs-you') return 'needs-you';
  return null;
}

// ---------- A stack: a larger module, one section per part ----------

/** A section of a stack's module, by its part's state: joined (merged), built (ready to join), at work, stuck, or waiting (a dim frame). */
export type SectionState = 'joined' | 'built' | 'working' | 'stuck' | 'waiting';

export const SECTION_WORDS: Record<SectionState, string> = {
  joined: 'joined',
  built: 'built, waiting to join',
  working: 'at work',
  stuck: 'stuck',
  waiting: 'waiting',
};

/** A stack part's state (stack.json) as its section on the module. */
export function sectionState(state: string): SectionState {
  switch (state) {
    case 'integrated': return 'joined';
    case 'ready': return 'built';
    case 'running': return 'working';
    case 'blocked': case 'failed': return 'stuck';
    default: return 'waiting';
  }
}

/** The stack's progress in words: "3 of 12 joined · 4 at work · 2 stuck". */
export function stackWords(states: readonly SectionState[]): string {
  const n = (s: SectionState) => states.filter((x) => x === s).length;
  const parts = [`${n('joined')} of ${states.length} joined`];
  if (n('working')) parts.push(`${n('working')} at work`);
  if (n('built')) parts.push(`${n('built')} built`);
  if (n('stuck')) parts.push(`${n('stuck')} stuck`);
  return parts.join(' · ');
}
