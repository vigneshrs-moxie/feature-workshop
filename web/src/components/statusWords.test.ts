// @vitest-environment node
// Status is never shown by colour alone (plan §7): every state the screens show has its words and,
// where it is a chip, an icon too; the words differ inside each family, so a reader can tell them
// apart without the colour. The Stage's state words come from the dashboard (stage-view.js) and must
// match the page's own.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Job, JobLane } from '../api/types';
import { LANE_INFO, stateChip } from '../home/JobsPage';
import { AGENT_STATUS, STATE_ICON } from '../job/StagePage';
import { GROUP_GLYPHS, GROUP_LABELS } from '../panes/Jobs/jobStatus';
import { StopMap } from './stops/StopMap';
import { STOPS, STOP_STATE_WORDS } from './stops/stops';

const distinct = (words: string[]) => new Set(words.map((w) => w.toLowerCase())).size === words.length;
const said = (w: string) => /\p{L}{2,}/u.test(w);

describe('status in words', () => {
  it('each lane of Jobs has its own word and icon', () => {
    const lanes = Object.keys(LANE_INFO) as JobLane[];
    expect(lanes).toEqual(['working', 'needs-you', 'in-review', 'ready', 'resting', 'done']);
    for (const l of lanes) { expect(said(LANE_INFO[l].word), l).toBe(true); expect(LANE_INFO[l].icon, l).toBeTruthy(); }
    expect(distinct(lanes.map((l) => LANE_INFO[l].word))).toBe(true);
  });

  it('a job card’s state chip always has a word and an icon: what it waits for, paused or working', () => {
    const base = { slug: 'a', title: 'A', group: 'running', stage: 'implement' } as unknown as Job;
    const chips = [
      stateChip({ ...base, lane: 'needs-you', group: 'needs-you', permissions: 1 } as Job),
      stateChip({ ...base, lane: 'needs-you', group: 'needs-you', waitingFor: 'answers' } as Job),
      stateChip({ ...base, lane: 'needs-you', group: 'needs-you' } as Job),
      stateChip({ ...base, lane: 'working', group: 'paused' } as Job),
      stateChip({ ...base, lane: 'working' } as Job),
      stateChip({ ...base, lane: 'in-review', group: 'shipping' } as Job),
    ];
    expect(chips.map((c) => c.word)).toEqual(['Permission', 'Question', 'Go-ahead', 'Paused', 'Working', 'In review']);
    for (const c of chips) expect(c.icon).toBeTruthy();
  });

  it('each job group has a word and its own glyph', () => {
    const groups = Object.keys(GROUP_LABELS) as (keyof typeof GROUP_LABELS)[];
    for (const g of groups) { expect(said(GROUP_LABELS[g]), g).toBe(true); expect(GROUP_GLYPHS[g], g).toBeTruthy(); }
    expect(distinct(groups.map((g) => GROUP_LABELS[g]))).toBe(true);
    expect(new Set(groups.map((g) => GROUP_GLYPHS[g])).size).toBe(groups.length);
  });

  it('each stop’s state has words and an icon, and the dashboard sends the same words', async () => {
    const states = Object.keys(STOP_STATE_WORDS) as (keyof typeof STOP_STATE_WORDS)[];
    for (const s of states) { expect(said(STOP_STATE_WORDS[s]), s).toBe(true); expect(STATE_ICON[s], s).toBeTruthy(); }
    expect(distinct(states.map((s) => STOP_STATE_WORDS[s]))).toBe(true);
    const server = fileURLToPath(new URL('../../../dashboard/lib/stage-view.js', import.meta.url));
    const mod = await import(/* @vite-ignore */ pathToFileURL(server).href) as { STOP_STATE_WORDS: Record<string, string> };
    expect(mod.STOP_STATE_WORDS).toEqual(STOP_STATE_WORDS);
  });

  it('each crew member’s status on a stop has a word and an icon', () => {
    const statuses = Object.keys(AGENT_STATUS) as (keyof typeof AGENT_STATUS)[];
    expect(statuses).toEqual(['working', 'waiting', 'done', 'stopped']);
    for (const s of statuses) { expect(said(AGENT_STATUS[s].word), s).toBe(true); expect(AGENT_STATUS[s].icon, s).toBeTruthy(); }
    expect(distinct(statuses.map((s) => AGENT_STATUS[s].word))).toBe(true);
  });

  it('the map of stops says every stop’s state in words, even with the names hidden', () => {
    const job = { stage: 'implement', stageState: 'running', lane: 'working', needsYou: false, skipped: ['wireframe'], closed: false } as unknown as Parameters<typeof StopMap>[0]['job'];
    for (const compact of [false, true]) {
      const html = renderToStaticMarkup(createElement(StopMap, { job, compact }));
      const items = [...html.matchAll(/<li\b[\s\S]*?<\/li>/g)].map((m) => m[0].replace(/<[^>]+>/g, ' '));
      expect(items).toHaveLength(STOPS.length);
      for (const [i, text] of items.entries()) expect(Object.values(STOP_STATE_WORDS).some((w) => text.includes(w)), `${STOPS[i].label}: ${text}`).toBe(true);
    }
  });
});
