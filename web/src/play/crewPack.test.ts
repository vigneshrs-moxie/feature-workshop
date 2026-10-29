// @vitest-environment node
// The crew pack (packet M): one place for the crew's names, generic roles and looks. The Crew-dex
// and the faces read it through crew.ts; the Stage's server (dashboard/lib/stage-view.js) says the
// same role words. Nothing here is fetched.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CREW, crewInfo } from './crew';
import { CREW_PACK, initialsOf, nameOf, ROLE_WORDS, roleOf, STOP_CREW } from './crewPack';

describe('the crew pack', () => {
  it('is the Crew-dex: same members, same order, same names', () => {
    expect(CREW.map((c) => c.type)).toEqual(CREW_PACK.map((m) => m.type));
    expect(CREW.map((c) => c.name)).toEqual(CREW_PACK.map((m) => m.name));
    expect(crewInfo('feature-planner').roleWord).toBe('Planner');
  });

  it('has generic role words, the Foreman for none and Helper for an unknown helper', () => {
    expect(['feature-planner', 'feature-implementer', 'feature-tester', 'feature-reviewer'].map(roleOf)).toEqual(['Planner', 'Builder', 'Tester', 'Reviewer']);
    expect(roleOf(null)).toBe('Foreman');
    expect(roleOf('some-helper')).toBe('Helper');
    expect(roleOf('feature-wireframer')).toBe('Designer');
    expect(initialsOf('feature-review-permissions')).toBe('AR');
    expect(nameOf('feature-wireframer')).toBe(nameOf('feature-review-ui'));
  });

  it('names a crew member for every stop', () => {
    for (const type of Object.values(STOP_CREW)) expect(ROLE_WORDS[type], type).toBeTruthy();
  });

  it('says the same role words as the Stage’s server', () => {
    const src = readFileSync(fileURLToPath(new URL('../../../dashboard/lib/stage-view.js', import.meta.url)), 'utf8');
    const block = /const ROLE_WORDS = \{([\s\S]*?)\};/.exec(src)?.[1] ?? '';
    const server = Object.fromEntries([...block.matchAll(/'?([\w-]+)'?:\s*'([^']+)'/g)].map((m) => [m[1], m[2]]));
    expect(Object.keys(server).length).toBeGreaterThan(10);
    for (const [type, word] of Object.entries(server)) expect(ROLE_WORDS[type], type).toBe(word);
  });
});
