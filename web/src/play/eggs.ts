// The easter eggs the page finds (design doc section 5), as pure rules plus a tiny store for the
// short scenes some of them play. Nothing here is explained on screen: the Crew-dex only counts
// "Secrets found". The dashboard finds the other three itself (the teapot, the headers and the Hex
// Sommelier commit). Never a model call; with Play mode Off none of them does anything.
//   konami         ↑↑↓↓←→←→BA outside a text field: the CRT Terminal theme
//   hammertime     ⌘K "hammertime": the Builder dances
//   sandwich       ⌘K "sudo make me a sandwich": "Okay." (xkcd 149)
//   rm-rf          ⌘K "rm -rf /": the Locksmith slams a door over the palette
//   git-blame      ⌘K "git blame": the crew point at each other
//   console        the DevTools console: crew art, and crew.hello()
//   sleuth-404     a #/ address that isn't a page: the Sleuth looks for it
//   foreman-clicks the Foreman by a job's title clicked seven times: a one-liner
//   friday-push    a git push permission card on a Friday after 4pm: the Locksmith's eyebrow
//   seasonal-hats  the crew in seasonal hats on a few dates (and nightcaps, midnight to 5am)
import { useSyncExternalStore } from 'react';
import type { Permission } from '../api/types';

export type PageSecret = 'konami' | 'hammertime' | 'sandwich' | 'rm-rf' | 'git-blame' | 'console' | 'sleuth-404' | 'foreman-clicks' | 'friday-push' | 'seasonal-hats';

// ---------- ⌘K ----------

export type PaletteEgg = 'hammertime' | 'sandwich' | 'rm-rf' | 'git-blame';

const PALETTE_EGGS: Record<string, PaletteEgg> = {
  hammertime: 'hammertime',
  'hammer time': 'hammertime',
  'sudo make me a sandwich': 'sandwich',
  'rm -rf /': 'rm-rf',
  'sudo rm -rf /': 'rm-rf',
  'rm -rf /*': 'rm-rf',
  'git blame': 'git-blame',
};

/** The palette egg typed exactly (any case, extra spaces ignored), or null. */
export function paletteEgg(query: string): PaletteEgg | null {
  return PALETTE_EGGS[query.trim().toLowerCase().replace(/\s+/g, ' ')] ?? null;
}

// ---------- The Konami code ----------

export const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'] as const;

/** How far into the code a key takes you (KONAMI.length: entered). A wrong key starts again, or at 1 if it is the first key. */
export function konamiStep(at: number, key: string): number {
  const k = key.length === 1 ? key.toLowerCase() : key;
  if (k === KONAMI[at]) return at + 1;
  return k === KONAMI[0] ? (at === 2 ? 2 : 1) : 0;
}

/** A key typed into a field (text, a textarea, a select or anything editable) is never part of a code. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
}

// ---------- Seasonal hats and nightcaps ----------

export type SeasonHat = 'witch' | 'santa' | 'party';
export type ExtraHat = SeasonHat | 'nightcap';

/** The season's hat on a few dates (local time): Halloween, Christmas, New Year. */
export function seasonHat(d: Date): SeasonHat | null {
  const m = d.getMonth() + 1;
  const day = d.getDate();
  if (m === 10 && day === 31) return 'witch';
  if (m === 12 && day >= 24 && day <= 26) return 'santa';
  if ((m === 12 && day === 31) || (m === 1 && day === 1)) return 'party';
  return null;
}

/** What the crew wear instead of their own hats now: the season's, else a nightcap from midnight to 5am, else nothing. */
export function extraHat(d: Date): ExtraHat | null {
  return seasonHat(d) ?? (d.getHours() < 5 ? 'nightcap' : null);
}

// The crew's clock: the real one, or a fixed one in tests (so snapshots never depend on the hour).
let clock: () => Date = () => new Date();
export const crewNow = () => clock();
/** Tests only: fix the crew's clock (null: the real one again). */
export function setCrewClock(fn: (() => Date) | null) {
  clock = fn ?? (() => new Date());
}

// ---------- A git push on a Friday afternoon ----------

/** A permission card for a git push, shown on a Friday from 4pm (local time). Looking only: it never changes the decision. */
export function isFridayPush(p: Pick<Permission, 'toolName' | 'input'>, now: Date): boolean {
  if (now.getDay() !== 5 || now.getHours() < 16) return false;
  const cmd = typeof p.input?.command === 'string' ? p.input.command : '';
  // git, its own options (-C <path> and -c <name=value> take a value), then push.
  return p.toolName === 'Bash' && /(^|[\s;&|(])git\s+(?:-[Cc]\s+\S+\s+|-\S+\s+)*push\b/.test(cmd);
}

// ---------- The Foreman, knocked on ----------

/** Clicks on the Foreman that make a knock-knock, each within this long of the one before. */
export const KNOCKS = 7;
export const KNOCK_GAP_MS = 1500;

/** The Foreman's one-liners (a fixed local list). */
export const FOREMAN_LINES = [
  'Seven knocks. Nobody’s home but us.',
  'I’m not a button. Well. Not usually.',
  'Measure twice, merge once.',
  'It works on my machine. I don’t have a machine.',
  'The crew says hi. The Stickler says “Hi.”',
  'Every job is small until you open the folder.',
  'Have you tried turning the spec off and on again?',
];

/** The nth one-liner (counting from 0), round the list. */
export const foremanLine = (n: number) => FOREMAN_LINES[((n % FOREMAN_LINES.length) + FOREMAN_LINES.length) % FOREMAN_LINES.length];

// ---------- The DevTools console ----------

export const CONSOLE_ART = String.raw`
   _____      _____      _____      _____
  [_____]    (_____)    /_____\    {_____}
   (o o)      (o o)      (o o)      (o o)
  --(_)--    --(_)--    --(_)--    --(_)--
   Foreman    Scribe     Sleuth     Builder

  The Feature Workshop crew, at your service.
  Psst: say hello. Type  crew.hello()  here.`;

export const CONSOLE_HELLO = 'Hello back from all fifteen of us. A hint, since you asked nicely: the kettle is on at /api/teapot.';

// ---------- Scenes ----------
// A scene: a few seconds of a crew member doing something, shown with the toasts (bottom-right,
// over the Preview pane: never over the composer, a gate card or a permission card). Its motion is
// under 1.5 s and holds still under reduced motion; its words stay a little longer.

export type SceneKind = 'hammertime' | 'sandwich' | 'git-blame' | 'foreman' | 'konami';

export interface Scene {
  key: number;
  kind: SceneKind;
  /** What it says (also read out). */
  line: string;
}

/** How long a scene stays (its words); its motion is over well before. */
export const SCENE_MS = 4000;

const SCENE_LINES: Record<Exclude<SceneKind, 'foreman'>, string> = {
  hammertime: 'Stop! Hammer time.',
  sandwich: 'Okay.',
  'git-blame': 'git blame: it was them. No, them. No…',
  konami: 'CRT Terminal unlocked. The screen is warming up.',
};

let scenes: Scene[] = [];
let nextKey = 1;
const listeners = new Set<() => void>();
const tell = () => { for (const l of [...listeners]) l(); };

/** Play a scene (line: the Foreman's one-liner). One of each kind at a time. */
export function showScene(kind: SceneKind, line?: string) {
  const scene = { key: nextKey++, kind, line: line ?? (kind === 'foreman' ? foremanLine(0) : SCENE_LINES[kind]) };
  scenes = [...scenes.filter((s) => s.kind !== kind), scene];
  tell();
}

export function endScene(key: number) {
  if (!scenes.some((s) => s.key === key)) return;
  scenes = scenes.filter((s) => s.key !== key);
  tell();
}

/** Tests only: no scenes. */
export function clearScenes() {
  scenes = [];
  tell();
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const read = () => scenes;

export function useScenes(): Scene[] {
  return useSyncExternalStore(subscribe, read, read);
}
