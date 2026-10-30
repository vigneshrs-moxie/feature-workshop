// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { SETTINGS_SECTIONS } from '../../app/router';
import { findSettings, joinWords, notifyLine, SECTION_WORDS, SETTING_INDEX, stepSection, valueLines } from './sections';

const FINISH_LINES = [{ id: 'pr1-merged', label: 'PR #1 merged' }, { id: 'main', label: 'In main' }];

describe('Settings sections', () => {
  it('names every section the router knows, in its order', () => {
    expect(SETTINGS_SECTIONS).toEqual(['permissions', 'notifications', 'look', 'keys', 'workflow', 'repos', 'play', 'rules']);
    for (const s of SETTINGS_SECTIONS) expect(SECTION_WORDS[s].label).toBeTruthy();
    expect(stepSection('permissions', -1)).toBe('rules');
    expect(stepSection('rules', 1)).toBe('permissions');
    expect(stepSection('look', 1)).toBe('keys');
  });

  it('writes each rail row’s value in a few words', () => {
    const lines = valueLines({ settings: { policy: 'auto', workflow: { finishLine: 'main' } }, finishLines: FINISH_LINES, theme: 'glass', textSize: 'm', keysOn: true, rules: 3 });
    expect(lines).toEqual({
      permissions: 'Auto mode',
      notifications: 'Needs you, Problems and Done on',
      look: 'Glass · M · One at a time · Four lanes · Play subtle',
      keys: 'On',
      workflow: 'Finish line: In main · GitHub every 1 min',
      repos: 'Profiles for each repository',
      play: 'Subtle',
      rules: '3 rules',
    });
    const quiet = valueLines({ settings: { policy: 'hands-off', notify: { enabled: true, levels: { needs: 'sound', problem: 'silent', done: 'off' }, quiet: { on: false, from: '22:00', to: '07:00' }, skipWhenWatching: true }, play: { mode: 'off', sounds: false } }, finishLines: undefined, theme: 'nonsense', textSize: 'xl', keysOn: false, rules: 0 });
    expect(quiet.permissions).toBe('Routine steps automatic');
    expect(quiet.notifications).toBe('Needs you and Problems on');
    expect(quiet.look).toBe('Default · XL · One at a time · Four lanes · Play off');
    expect(valueLines({ settings: { play: { mode: 'full' } } as never, finishLines: undefined, theme: 'default', textSize: 'm', keysOn: true, rules: 1, deskLayout: 'columns', jobsLayout: 'list' }).look).toBe('Default · M · Three columns · One list · Play full');
    expect(quiet.keys).toBe('Off');
    expect(quiet.workflow).toBe('Finish line: PR #1 merged · GitHub every 1 min');
    expect(quiet.play).toBe('Off');
    expect(quiet.rules).toBe('No rules');
    expect(valueLines({ settings: undefined, finishLines: undefined, theme: 'default', textSize: 'm', keysOn: true, rules: 1 }).rules).toBe('1 rule');
    expect(valueLines({ settings: undefined, finishLines: undefined, theme: 'default', textSize: 'm', keysOn: true, rules: null }).rules).toBe('Loading…');
    expect(valueLines({ settings: undefined, finishLines: undefined, theme: 'default', textSize: 'm', keysOn: true, rules: 'error' }).rules).toBe('Couldn’t load');
    expect(notifyLine({ policy: 'hands-off', notify: { enabled: false, levels: { needs: 'sound', problem: 'sound', done: 'sound' }, quiet: { on: false, from: '22:00', to: '07:00' }, skipWhenWatching: true } })).toBe('Off');
    expect(notifyLine({ policy: 'hands-off', notify: { enabled: true, levels: { needs: 'off', problem: 'off', done: 'off' }, quiet: { on: false, from: '22:00', to: '07:00' }, skipWhenWatching: true } })).toBe('On, every kind off');
    expect(joinWords(['a'])).toBe('a');
    expect(joinWords([])).toBe('');
  });

  it('finds a setting by its label, another word for it, or its section, in any case; nothing for an empty query', () => {
    expect(findSettings('')).toEqual([]);
    expect(findSettings('   ')).toEqual([]);
    expect(findSettings('chime').map((e) => e.id)).toEqual(['alerts-browser']);
    expect(findSettings('DARK').map((e) => e.id)).toEqual(['theme', 'follow-system']);
    expect(findSettings('wireframe').map((e) => e.id)).toEqual(['wireframes']);
    expect(findSettings('finish').map((e) => e.id)).toEqual(['finish-line']);
    expect(findSettings('workflow').every((e) => e.section === 'workflow')).toBe(true);
    expect(findSettings('workflow')).toHaveLength(8); // with the Orbit token, how often GitHub is checked, who reviews and merges, and Claude Code use
    expect(findSettings('zebra')).toEqual([]);
    // Every entry belongs to a known section, and no anchor is used twice.
    for (const e of SETTING_INDEX) expect(SETTINGS_SECTIONS).toContain(e.section);
    expect(new Set(SETTING_INDEX.map((e) => e.id)).size).toBe(SETTING_INDEX.length);
  });
});
