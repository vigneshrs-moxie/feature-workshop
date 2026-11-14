// ⌘K's list (Task 19, R6): every ask, the page's places and his kept asks, in one order; the search
// matches the label, the exact text an ask sends, or its group. The box itself is tested on the page
// (left/AsksRow.test.tsx, "⌘K").
import { describe, expect, it } from 'vitest';
import { ASKS } from './asks';
import { longJob } from './fixtures/longJob';
import { matches, paletteItems } from './Palette';
import type { JobPagePayload } from './types';

const steps = () => (JSON.parse(JSON.stringify(longJob.payload)) as unknown as JobPagePayload).steps;
const label = (i: ReturnType<typeof paletteItems>[number]) => (i.kind === 'ask' ? i.ask.label : i.label);

describe('the list', () => {
  it('has the open step’s asks, then any step’s, Yours, the places, the other steps’ asks, then the app’s ⌘K', () => {
    const items = paletteItems('test', steps(), ['check ok']);
    const groups = [...new Set(items.map((i) => i.group))];
    expect(groups).toEqual(['For this step', 'Any step', 'Yours', 'Places', 'Other steps', 'Starbase']);
    expect(items.filter((i) => i.group === 'For this step').map(label)).toEqual(['How do I test this by hand?', 'Ask to start the app', 'It works', 'Run the checks again', 'Record again', 'Something is wrong…']);
    expect(items.filter((i) => i.group === 'Yours').map(label)).toEqual(['check ok']);
    // The row's order first, then the step's ⌘K-only asks.
    expect(paletteItems('review', steps(), []).filter((i) => i.group === 'For this step').map(label)).toEqual(['Fix the open findings', 'Go faster', 'Publish the walkthrough']);
    expect(label(items.at(-1)!)).toBe('Every Starbase action');
  });

  it('lists every ask once', () => {
    const asks = paletteItems('review', steps(), []).filter((i) => i.kind === 'ask');
    expect(asks.map(label).sort()).toEqual(ASKS.map((a) => a.label).sort());
  });

  it('names a place for each step begun, each thing it made, and the job’s four rows', () => {
    const places = paletteItems('review', steps(), []).filter((i) => i.group === 'Places').map(label);
    expect(places).toContain('Go to: Spec');
    expect(places).toContain('Go to: Product spec');
    expect(places).toContain('Go to: Build');
    expect(places.slice(-4)).toEqual(['Go to: Ticket and goal', 'Go to: Conversation', 'Go to: Decisions', 'Go to: Details']);
    expect(new Set(places).size).toBe(places.length);
    // A step not begun has nothing to go to.
    const s = steps();
    const ship = s.find((x) => x.id === 'ship')!;
    ship.state = 'todo';
    expect(paletteItems('review', s, []).filter((i) => i.group === 'Places').map(label)).not.toContain('Go to: Ship');
  });

  it('a kept ask that is long shows a short label and keeps its whole text', () => {
    const long = 'Look at the latest comments on the pull request and make the changes they ask for, one commit each.';
    const kept = paletteItems(null, steps(), [long]).find((i) => i.group === 'Yours')!;
    expect(kept.kind === 'ask' && kept.ask.label.length).toBe(60);
    expect(kept.kind === 'ask' && kept.ask.text).toBe(long);
  });
});

describe('the search', () => {
  const items = paletteItems('plan', steps(), []);
  const find = (q: string) => items.filter((i) => matches(i, q)).map(label);

  it('matches every word against the label, the exact text or the group', () => {
    expect(find('scope')).toEqual(['Drop something…']);
    expect(find('go to plan')[0]).toBe('Go to: Plan');
    expect(find('go to plan')).toContain('Go to: Implementation plan');
    expect(find('CHECKS again')).toEqual(['Run the checks again', 'Record again']);
    expect(find('')).toHaveLength(items.length);
    expect(find('nothing like this')).toEqual([]);
  });
});

describe('the Ship asks (Task 22)', () => {
  it('For this step on Ship: the row’s three, then Test steps for stakeholders, Fix the ticket number…, New branch with only this change', () => {
    expect(paletteItems('ship', steps(), []).filter((i) => i.group === 'For this step').map(label)).toEqual([
      'Pull PR comments', 'Shorten the PR text', 'Mark done', 'Test steps for stakeholders', 'Fix the ticket number…', 'New branch with only this change',
    ]);
  });

  it('the website lists neither Pull PR comments nor Mark done, on any step', () => {
    for (const step of ['ship', 'test', null] as const) {
      const labels = paletteItems(step, steps(), [], true).filter((i) => i.kind === 'ask').map(label);
      expect(labels).not.toContain('Pull PR comments');
      expect(labels).not.toContain('Mark done');
      expect(labels).toContain('Shorten the PR text');
    }
  });
});

describe('final W4: the website', () => {
  it('lists no Ask to start the app (no Try it there), and the laptop does', () => {
    expect(paletteItems('test', steps(), [], true).map(label)).not.toContain('Ask to start the app');
    expect(paletteItems('test', steps(), []).map(label)).toContain('Ask to start the app');
  });
});
