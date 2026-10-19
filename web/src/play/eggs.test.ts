// The easter eggs' pure rules (play/eggs.ts): the palette's phrases, the Konami code, seasonal
// hats and nightcaps, the Friday push, the Foreman's lines and the scenes store.
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearScenes, endScene, extraHat, FOREMAN_LINES, foremanLine, isFridayPush, isTypingTarget, KONAMI, konamiStep, paletteEgg, seasonHat,
  showScene, useScenes,
} from './eggs';

afterEach(() => clearScenes());

describe('palette phrases', () => {
  it('match exactly, in any case, extra spaces ignored', () => {
    expect(paletteEgg('hammertime')).toBe('hammertime');
    expect(paletteEgg('  HammerTime ')).toBe('hammertime');
    expect(paletteEgg('sudo   make me a sandwich')).toBe('sandwich');
    expect(paletteEgg('rm -rf /')).toBe('rm-rf');
    expect(paletteEgg('git blame')).toBe('git-blame');
  });
  it('never match part of a phrase, or an ordinary search', () => {
    for (const q of ['hammer', 'make me a sandwich', 'rm -rf', 'git', 'git blame me', 'settings', '']) expect(paletteEgg(q)).toBeNull();
  });
});

describe('the Konami code', () => {
  const enter = (keys: readonly string[], from = 0) => keys.reduce((at, k) => konamiStep(at, k), from);
  it('is entered by the ten keys in order (B and A in either case)', () => {
    expect(enter(KONAMI)).toBe(KONAMI.length);
    expect(enter([...KONAMI.slice(0, 8), 'B', 'A'])).toBe(KONAMI.length);
  });
  it('starts again on a wrong key, keeping an extra ↑ at the start', () => {
    expect(enter(['ArrowUp', 'ArrowUp', 'ArrowUp', ...KONAMI.slice(2)])).toBe(KONAMI.length);
    expect(enter(['ArrowUp', 'x', ...KONAMI])).toBe(KONAMI.length);
    expect(enter(KONAMI.slice(0, 5))).toBe(5);
    expect(konamiStep(5, 'ArrowDown')).toBe(0);
    expect(konamiStep(5, 'ArrowUp')).toBe(1);
  });
  it('never counts keys typed into a field', () => {
    const input = document.createElement('input');
    const area = document.createElement('textarea');
    const div = document.createElement('div');
    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget(area)).toBe(true);
    expect(isTypingTarget(div)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('hats', () => {
  it('the season’s on Halloween, Christmas and New Year, nothing on other days', () => {
    expect(seasonHat(new Date(2026, 9, 31, 12))).toBe('witch');
    expect(seasonHat(new Date(2026, 11, 25, 12))).toBe('santa');
    expect(seasonHat(new Date(2026, 11, 31, 12))).toBe('party');
    expect(seasonHat(new Date(2027, 0, 1, 12))).toBe('party');
    expect(seasonHat(new Date(2026, 9, 30, 12))).toBeNull();
    expect(seasonHat(new Date(2026, 5, 17, 12))).toBeNull();
  });
  it('nightcaps from midnight to 5am, unless it is a seasonal day', () => {
    expect(extraHat(new Date(2026, 5, 17, 0, 10))).toBe('nightcap');
    expect(extraHat(new Date(2026, 5, 17, 4, 59))).toBe('nightcap');
    expect(extraHat(new Date(2026, 5, 17, 5, 0))).toBeNull();
    expect(extraHat(new Date(2026, 5, 17, 23, 59))).toBeNull();
    expect(extraHat(new Date(2026, 9, 31, 2))).toBe('witch');
  });
});

describe('a git push on a Friday afternoon', () => {
  const push = (command: string, toolName = 'Bash') => ({ toolName, input: { command } });
  const FRI_1630 = new Date(2026, 9, 16, 16, 30); // 16 Oct 2026 is a Friday
  it('is a Bash git push from Friday 4pm', () => {
    expect(isFridayPush(push('git push origin feature/x'), FRI_1630)).toBe(true);
    expect(isFridayPush(push('cd repo && git -C . push --force-with-lease'), FRI_1630)).toBe(true);
    expect(isFridayPush(push('git push'), new Date(2026, 9, 16, 23, 59))).toBe(true);
  });
  it('is nothing earlier on a Friday, on another day, or for anything else', () => {
    expect(isFridayPush(push('git push'), new Date(2026, 9, 16, 15, 59))).toBe(false);
    expect(isFridayPush(push('git push'), new Date(2026, 9, 15, 17))).toBe(false);
    expect(isFridayPush(push('git pull'), FRI_1630)).toBe(false);
    expect(isFridayPush(push('legit pushup'), FRI_1630)).toBe(false);
    expect(isFridayPush(push('git push', 'Write'), FRI_1630)).toBe(false);
    expect(isFridayPush({ toolName: 'Bash' }, FRI_1630)).toBe(false);
  });
});

describe('the Foreman’s lines', () => {
  it('go round a fixed list', () => {
    expect(foremanLine(0)).toBe(FOREMAN_LINES[0]);
    expect(foremanLine(FOREMAN_LINES.length)).toBe(FOREMAN_LINES[0]);
    expect(foremanLine(-1)).toBe(FOREMAN_LINES[FOREMAN_LINES.length - 1]);
  });
});

describe('scenes', () => {
  it('one of each kind at a time, gone when ended', () => {
    const { result } = renderHook(() => useScenes());
    act(() => showScene('hammertime'));
    act(() => showScene('foreman', 'Hello.'));
    act(() => showScene('hammertime'));
    expect(result.current.map((s) => s.kind)).toEqual(['foreman', 'hammertime']);
    expect(result.current[0].line).toBe('Hello.');
    expect(result.current[1].line).toBe('Stop! Hammer time.');
    act(() => endScene(result.current[0].key));
    expect(result.current.map((s) => s.kind)).toEqual(['hammertime']);
  });
});
