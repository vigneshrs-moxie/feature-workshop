// The Settings page's sections (app/router.ts SETTINGS_SECTIONS has the ids and the order): their
// words, the one muted line each rail row shows with the section's current value, and the index the
// "Find a setting" box searches: every control, by label and a few other words, with the
// data-setting anchor the page highlights when you jump to it.
import type { PolicyId, Settings } from '../../api/types';
import { SETTINGS_SECTIONS, type SettingsSection } from '../../app/router';
import { POLICIES } from '../../components/permissions/policies';
import { playOf } from '../../play/settings';
import { TEXT_SIZE_LABELS, type TextSize } from '../../theme/textSize';
import { THEMES } from '../../theme/theme';
import { LEVELS, NOTIFY_DEFAULTS } from './NotifySettings';
import { PLAY_MODE_CHOICES } from './PlaySettings';
import { finishLineLabel, githubEveryLine } from './WorkflowSettings';
import { BRAND } from '../../app/brand';

export const SECTION_WORDS: Record<SettingsSection, { label: string; hint: string }> = {
  permissions: { label: 'Permissions', hint: 'How much the Foreman and its crew may do without asking you.' },
  notifications: { label: 'Notifications', hint: 'What the dashboard tells macOS, and this browser’s own alerts.' },
  look: { label: 'Look', hint: 'Theme, text size, following the system’s light or dark, the Desk and Jobs layouts, the Stack picture, and Play.' },
  keys: { label: 'Keys', hint: 'Keyboard shortcuts on or off, and the key hints on buttons.' },
  workflow: { label: 'Workflow', hint: 'The finish line, how often GitHub is checked, what a new job starts with, and whether Telemetry counts your Claude Code use.' },
  repos: { label: 'Repos', hint: `The repositories ${BRAND.name} knows, and the profile each one follows.` },
  play: { label: 'Play', hint: 'The workshop crew, achievements and sounds.' },
  rules: { label: 'Rules', hint: 'The “Always allow” rules you saved from permission cards.' },
};

export const FIRST_SECTION: SettingsSection = SETTINGS_SECTIONS[0];

/** The section `by` steps away from `from`, wrapping round (j and k on the rail). */
export function stepSection(from: SettingsSection, by: 1 | -1): SettingsSection {
  const at = SETTINGS_SECTIONS.indexOf(from);
  return SETTINGS_SECTIONS[(at + by + SETTINGS_SECTIONS.length) % SETTINGS_SECTIONS.length];
}

// ---------- The rail's value lines ----------

export interface SectionFacts {
  settings: Settings | undefined;
  /** meta.finishLines, when the dashboard sent them. */
  finishLines: { id: string; label: string }[] | undefined;
  theme: string;
  textSize: TextSize;
  keysOn: boolean;
  /** Settings → Look's Desk and Jobs layouts (this browser); One at a time and Four lanes when not given. */
  deskLayout?: 'one' | 'columns';
  jobsLayout?: 'lanes' | 'list';
  /** How many rules there are; null while loading, 'error' when they couldn't be read. */
  rules: number | null | 'error';
}

/** "Needs you and Problems" from ['Needs you', 'Problems']; "a, b and c" for three. */
export function joinWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

export function policyLine(policy: PolicyId | undefined): string {
  return POLICIES.find((p) => p.id === (policy ?? 'hands-off'))?.label ?? 'Routine steps automatic';
}

/** "Needs you and Problems on", "Off", or "On, every kind off". */
export function notifyLine(settings: Settings | undefined): string {
  const n = { ...NOTIFY_DEFAULTS, ...(settings?.notify ?? {}) };
  if (!n.enabled) return 'Off';
  const on = LEVELS.filter((l) => (n.levels?.[l.id] ?? NOTIFY_DEFAULTS.levels[l.id]) !== 'off').map((l) => l.label);
  return on.length ? `${joinWords(on)} on` : 'On, every kind off';
}

export function rulesLine(rules: SectionFacts['rules']): string {
  if (rules === null) return 'Loading…';
  if (rules === 'error') return 'Couldn’t load';
  return rules === 0 ? 'No rules' : rules === 1 ? '1 rule' : `${rules} rules`;
}

/** Each section's current value in a few words, for its rail row. */
export function valueLines(f: SectionFacts): Record<SettingsSection, string> {
  const theme = THEMES.find((t) => t.id === f.theme)?.label ?? 'Default';
  const play = PLAY_MODE_CHOICES.find((m) => m.id === playOf(f.settings).mode)?.label ?? 'Subtle';
  return {
    permissions: policyLine(f.settings?.policy),
    notifications: notifyLine(f.settings),
    // "Default · M · One at a time · Four lanes · Play full": everything Look sets, in its order.
    look: [theme, TEXT_SIZE_LABELS[f.textSize], f.deskLayout === 'columns' ? 'Three columns' : 'One at a time', f.jobsLayout === 'list' ? 'One list' : 'Four lanes', `Play ${play.toLowerCase()}`].join(' · '),
    keys: f.keysOn ? 'On' : 'Off',
    workflow: `Finish line: ${finishLineLabel(f.settings?.workflow?.finishLine, f.finishLines)} · ${githubEveryLine(f.settings)}`,
    repos: 'Profiles for each repository',
    play,
    rules: rulesLine(f.rules),
  };
}

// ---------- The search index ----------

export interface SettingEntry {
  /** The data-setting anchor on the control, highlighted after a jump. */
  id: string;
  label: string;
  section: SettingsSection;
  /** Other words people might type for it. */
  keywords?: string;
}

export const SETTING_INDEX: SettingEntry[] = [
  { id: 'policy', label: 'Permissions: ask about everything, routine steps automatic, auto mode', section: 'permissions', keywords: 'permission policy approve hands off safety' },
  { id: 'notify-enabled', label: 'Send notifications to macOS', section: 'notifications', keywords: 'mac os terminal-notifier outside the browser' },
  { id: 'notify-levels', label: 'Needs you, Problems, Done: with a sound, silent or off', section: 'notifications', keywords: 'sound silent kinds levels' },
  { id: 'notify-quiet', label: 'Quiet hours', section: 'notifications', keywords: 'night do not disturb' },
  { id: 'notify-watching', label: 'Not while I’m looking at the dashboard', section: 'notifications', keywords: 'watching focus tab' },
  { id: 'alerts-browser', label: 'In this browser: notifications and chime', section: 'notifications', keywords: 'alerts browser chime sound tab' },
  { id: 'notify-test', label: 'Send a test notification', section: 'notifications', keywords: 'try' },
  { id: 'notify-history', label: 'Notification history', section: 'notifications', keywords: 'sent log' },
  { id: 'notify-usage', label: 'Usage warnings at 80 %, 90 % and full', section: 'notifications', keywords: 'usage warnings 80 % 90 % plan usage limit' },
  { id: 'theme', label: 'Theme', section: 'look', keywords: 'dark light glass colours colors skin' },
  { id: 'text-size', label: 'Text size', section: 'look', keywords: 'font small medium large zoom' },
  { id: 'follow-system', label: 'Follow the system', section: 'look', keywords: 'dark mode light mode prefers color scheme' },
  { id: 'desk-layout', label: 'Desk layout: One at a time or Three columns', section: 'look', keywords: 'queue columns desk' },
  { id: 'jobs-layout', label: 'Jobs layout: Four lanes or One list', section: 'look', keywords: 'board lanes list kanban' },
  { id: 'stack-picture', label: 'Stack picture: Merge map or Four big steps', section: 'look', keywords: 'stacks parts map steps' },
  { id: 'look-play', label: 'Play in Look: Full, Subtle, Off', section: 'look', keywords: 'console crew game' },
  { id: 'keys-enabled', label: 'Keyboard shortcuts on or off', section: 'keys', keywords: 'keys hotkeys bindings' },
  { id: 'keys-hints', label: 'Show key hints on buttons', section: 'keys', keywords: 'kbd' },
  { id: 'keys-everywhere', label: 'Show keys on every button', section: 'keys', keywords: 'kbd hints always' },
  { id: 'finish-line', label: 'Finish line: what counts as done', section: 'workflow', keywords: 'pr merged staging main done quest' },
  { id: 'github-every', label: 'How often to check GitHub while waiting', section: 'workflow', keywords: 'github refresh check pull requests review minutes poll' },
  { id: 'pr-route', label: 'Who reviews and merges each pull request', section: 'workflow', keywords: 'github reviewer merges route pull request owner' },
  { id: 'wireframes', label: 'Screens (wireframes) for new jobs', section: 'workflow', keywords: 'mockups designs screens wireframe' },
  { id: 'clarify', label: 'Clarify questions for new jobs', section: 'workflow', keywords: 'questions before the spec audience' },
  { id: 'auto-level', label: 'Choose the level for me', section: 'workflow', keywords: 'automatic level l0 l1 l2 l3 suggest' },
  { id: 'count-claude-code', label: 'Count my Claude Code use outside the app', section: 'workflow', keywords: 'telemetry usage limit terminal logs other use' },
  { id: 'orbit-token', label: 'Orbit token', section: 'workflow', keywords: 'inbox read-only token portal feedback tickets orbfb' },
  { id: 'repos-list', label: 'Your repositories and their profiles', section: 'repos', keywords: 'repos repository profile ground-control.md registry remove check' },
  { id: 'repos-add', label: 'Add a repository', section: 'repos', keywords: 'repos repository profile file register new' },
  { id: 'play-mode', label: 'Play mode: Full, Subtle, Off', section: 'play', keywords: 'crew achievements game' },
  { id: 'play-sounds', label: 'Sounds (chiptune blips)', section: 'play', keywords: 'audio' },
  { id: 'rules', label: 'Always allow rules', section: 'rules', keywords: 'permission remove saved' },
];

/** The settings matching `query` (any case; the label, the other words, or the section's name); nothing for an empty query. */
export function findSettings(query: string): SettingEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return SETTING_INDEX.filter((e) => `${e.label} ${e.keywords ?? ''} ${SECTION_WORDS[e.section].label}`.toLowerCase().includes(q));
}
