// @vitest-environment node
// Go's body (Task 9) is byte for byte what today's gate card sends for the same picks: the same
// gate is given to today's gateCard.ts (gateRequest, the function GateCard.post calls) and to the
// new page's goBody, and the two JSON strings are compared whole (key order included).
import { describe, expect, it } from 'vitest';
import type { DecidedItem, Gate } from '../../api/types';
import { chipViews, gateRequest, initialChoices, OTHER, type GateChoices } from '../../lib/gateCard';
import type { GateMove } from '../types';
import { changedCount, gateBody, OWN, pickOf, unanswered, type GatePicks } from './gateBody';

// A made-up gate: three questions (one with no recommendation, one with no options), five decisions
// of which three are still open, in mixed order.
const MOVE: GateMove = {
  kind: 'gate', brief: 7, ask: 'Plan v2 is ready', since: '2026-11-10T09:00:00.000Z', stage: 'plan', nextStage: 'implement', goSays: 'start the build',
  questions: [
    { id: '1', text: 'Keep the old export?', options: [
      { id: 'a', label: 'Keep it', consequence: 'Nothing moves', recommended: true },
      { id: 'b', label: 'Drop it', consequence: null, recommended: false },
    ] },
    { id: '2', text: 'Which week first?', options: [
      { id: 'a', label: 'This week', consequence: null, recommended: false },
      { id: 'b', label: 'Last week', consequence: null, recommended: false },
    ] },
    { id: '3', text: 'What should the button say?', options: [] },
  ],
  decided: 5, openDecisions: ['D-2', 'Toast says Copied', 'D-5'], stale: false, parked: false,
};
const DECIDED: DecidedItem[] = [
  { id: 'D-1', decision: 'Head inspector only', reason: null, where: null, confirmed: true },
  { id: 'D-2', decision: 'Week starts Monday', reason: null, where: null, confirmed: false },
  { id: null, decision: 'Toast says Copied', reason: null, where: null, confirmed: false } as unknown as DecidedItem,
  { id: 'D-4', decision: 'Sort by name', reason: null, where: null, confirmed: true },
  { id: 'D-5', decision: 'CSV, not Excel', reason: null, where: null, confirmed: false },
];

/** The same gate as today's card holds it (status.json's shape, as gateView makes it). */
function oldGate(move: GateMove, decided: DecidedItem[] = DECIDED): Gate {
  return {
    briefNumber: move.brief, briefFile: null, headline: move.ask, stage: move.stage, nextStage: move.nextStage, nextProposed: null,
    questions: move.questions.map((q) => ({ id: q.id, text: q.text, recommendation: q.options.find((o) => o.recommended)?.id ?? null, options: q.options.map((o) => ({ id: o.id, label: o.label, consequence: o.consequence })) })),
    decided, versions: null, raisedVersions: null, stale: false, waitingSince: move.since, runActive: false, parked: false,
    level: 2, suggestedLevel: null, levelReason: null, usage: null,
  } as Gate;
}

/** Today's card's choices for the new page's picks (a pick, OTHER with words, or the recommendation). */
function oldChoices(gate: Gate, p: GatePicks): GateChoices {
  const c = initialChoices(gate);
  for (const [q, pick] of Object.entries(p.picks)) c.choices[q] = pick === OWN ? OTHER : pick;
  for (const [q, words] of Object.entries(p.own)) c.others[q] = words;
  return c;
}

/** Both bodies as JSON strings: today's (gateRequest, with GateCard.post's extra) and the new one. */
function both(p: GatePicks, extra: { confirmNoTerminal?: boolean; note?: string; startAfterReset?: boolean } = {}, kind: 'approve' | 'changes' | 'message' = 'approve', move = MOVE, decided = DECIDED) {
  const gate = oldGate(move, decided);
  // GateCard.post: { ...(noTerminal ? { confirmNoTerminal: true } : {}), ...extraFromAct }, and
  // approveNow's extra: { ...(note in the open Reply box ? { note } : {}), ...extra (startAfterReset) }.
  const fromAct = kind === 'approve'
    ? { ...(extra.note && extra.note.trim() ? { note: extra.note } : {}), ...(extra.startAfterReset ? { startAfterReset: true } : {}) }
    : { note: extra.note ?? '' };
  const old = gateRequest(kind, gate, oldChoices(gate, p), chipViews(gate, { level: 2 }), { ...(extra.confirmNoTerminal ? { confirmNoTerminal: true } : {}), ...fromAct });
  return { old: JSON.stringify(old), now: JSON.stringify(gateBody(kind, move, p, extra)) };
}

const NONE: GatePicks = { picks: {}, own: {} };

describe('Go’s body, byte for byte with today’s card', () => {
  it('the recommended picks, with the questions that have no recommendation answered', () => {
    const p: GatePicks = { picks: { 2: 'b' }, own: { 3: 'Copy rows' } };
    const { old, now } = both(p);
    expect(now).toBe(old);
    expect(now).toBe('{"kind":"approve","briefNumber":7,"answers":{"1":{"choice":"a"},"2":{"choice":"b"},"3":{"other":"Copy rows"}},"verdicts":{"D-2":{"verdict":"confirm"},"Toast says Copied":{"verdict":"confirm"},"D-5":{"verdict":"confirm"}},"chips":[]}');
  });

  it('a changed pick, your own answer (trimmed), and an own answer left empty (left out, as today)', () => {
    expect(both({ picks: { 1: 'b', 2: 'a' }, own: { 3: '  Copy rows  ' } }).now).toBe(both({ picks: { 1: 'b', 2: 'a' }, own: { 3: '  Copy rows  ' } }).old);
    const own = both({ picks: { 1: OWN, 2: 'a' }, own: { 1: 'Keep it for a month', 3: 'Copy' } });
    expect(own.now).toBe(own.old);
    expect(own.now).toContain('"1":{"other":"Keep it for a month"}');
    const empty = both({ picks: { 1: OWN, 2: 'a' }, own: { 1: '   ' } });
    expect(empty.now).toBe(empty.old);
    expect(empty.now).not.toContain('"1":');
  });

  it('with the terminal confirmed, words from the message box, and after the reset: in today’s order', () => {
    const p: GatePicks = { picks: { 2: 'a' }, own: { 3: 'Copy' } };
    for (const extra of [
      { note: 'Mind the totals row.' },
      { note: '  Keep it short \n' },
      { note: '   ' },
      { confirmNoTerminal: true },
      { startAfterReset: true },
      { confirmNoTerminal: true, note: 'Mind the totals row.', startAfterReset: true },
    ]) {
      const { old, now } = both(p, extra);
      expect(now, JSON.stringify(extra)).toBe(old);
    }
    expect(both(p, { confirmNoTerminal: true, note: 'N', startAfterReset: true }).now).toMatch(/"chips":\[\],"confirmNoTerminal":true,"note":"N","startAfterReset":true\}$/);
  });

  it('every decision already confirmed: verdicts is {}; a gate with no number keeps briefNumber null', () => {
    const confirmed = DECIDED.map((d) => ({ ...d, confirmed: true }));
    const move = { ...MOVE, brief: null, openDecisions: [] };
    const { old, now } = both({ picks: { 2: 'a' }, own: { 3: 'x' } }, {}, 'approve', move, confirmed);
    expect(now).toBe(old);
    expect(now).toContain('"briefNumber":null');
    expect(now).toContain('"verdicts":{}');
  });

  it('Send back and a message from the card (for the message box, Task 11): the same as today too', () => {
    const p: GatePicks = { picks: { 1: 'b' }, own: {} };
    for (const kind of ['changes', 'message'] as const) {
      const { old, now } = both(p, { note: 'Use the new column.', confirmNoTerminal: true }, kind);
      expect(now, kind).toBe(old);
    }
  });
});

describe('the picks', () => {
  it('a question’s pick is his, else the recommended option; nothing for a question with no recommendation', () => {
    expect(pickOf(MOVE.questions[0], NONE)).toBe('a');
    expect(pickOf(MOVE.questions[0], { picks: { 1: 'b' }, own: {} })).toBe('b');
    expect(pickOf(MOVE.questions[1], NONE)).toBeNull();
    expect(pickOf(MOVE.questions[2], NONE)).toBeNull();
  });

  it('counts the questions answered other than the recommendation, and finds the first left unanswered', () => {
    expect(changedCount(MOVE, NONE)).toBe(0);
    expect(unanswered(MOVE, NONE)).toBe(2);
    const p: GatePicks = { picks: { 1: 'b', 2: 'a' }, own: { 3: 'Copy' } };
    expect(changedCount(MOVE, p)).toBe(3);
    expect(unanswered(MOVE, p)).toBeNull();
    expect(changedCount(MOVE, { picks: { 1: 'a' }, own: {} })).toBe(0);
    expect(unanswered(MOVE, { picks: { 1: OWN, 2: 'a' }, own: { 1: ' ', 3: 'x' } })).toBe(1);
  });
});
