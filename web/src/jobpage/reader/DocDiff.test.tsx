// What changed since vN (Task 18, R5): a document with an older version has `What changed since v2`
// in its title row; pressed, the reader marks the lines added and removed since that version (the
// stored older version against the text now, worked out on the page). Made-up job.
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installKeyListener, resetChord } from '../../app/keyRegistry';
import { clearAllSent } from '../../lib/sentState';
import { clearGateSent } from '../../panes/Foreman/gateSent';
import { bodyOf, openNotes, PLAN, reader, settle } from '../fixtures/notesPage';
import { forgetSentGo } from '../left/YourMove';
import { forgetRecentPages } from '../recent';
import type { JobBody, JobPagePayload } from '../types';
import { lineDiff } from './docDiff';

const OLD_ID = 'versions/implementation-plan.v2.md';
const NOW = bodyOf(PLAN)!;
/** v2: the plan now with its S1 paragraph different and its last section gone. */
const OLD_TEXT = NOW.text
  .replace('The schedule page waits for the van number while the table loads.', 'The schedule page loads the whole week at once.')
  .concat('\n### S6: The old export button\n\nIt stays for admins.\n');
const OLD: JobBody = { id: OLD_ID, kind: 'doc', version: 'h-old', html: '<p>v2</p>', text: OLD_TEXT, meta: { name: 'Implementation plan', version: '2' } };

/** The plan is v3 now and keeps v2 in its versions folder. */
const withV2 = (p: JobPagePayload) => {
  for (const s of p.steps) for (const o of [...s.outputs, ...(s.more ?? [])]) if (o.id === PLAN) { o.version = '3'; o.versions = [{ n: '2', id: OLD_ID }]; }
};
const toggle = () => screen.queryByRole('button', { name: /^What changed since/ });

let offKeys: () => void = () => {};
beforeEach(() => {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: /min-width/.test(q), media: q, addEventListener() {}, removeEventListener() {} }));
  localStorage.clear(); forgetRecentPages(); forgetSentGo(); offKeys = installKeyListener(); resetChord();
});
afterEach(() => { offKeys(); vi.unstubAllGlobals(); localStorage.clear(); clearAllSent(); clearGateSent(); window.history.replaceState(null, '', '/'); });

describe('lineDiff', () => {
  it('marks the lines added and removed, the same lines kept in order', () => {
    expect(lineDiff('a\nb\nc\nd', 'a\nB\nc\nd\ne')).toEqual([
      { kind: 'same', text: 'a' }, { kind: 'del', text: 'b' }, { kind: 'add', text: 'B' }, { kind: 'same', text: 'c' }, { kind: 'same', text: 'd' }, { kind: 'add', text: 'e' },
    ]);
    expect(lineDiff('', 'x')).toEqual([{ kind: 'del', text: '' }, { kind: 'add', text: 'x' }]);
    expect(lineDiff('same\ntext', 'same\ntext').every((l) => l.kind === 'same')).toBe(true);
  });

  it('stays quick on a long document with changes all through it', () => {
    const a = Array.from({ length: 4000 }, (_, i) => `line ${i}`).join('\n');
    const b = Array.from({ length: 4000 }, (_, i) => (i % 50 === 0 ? `changed ${i}` : `line ${i}`)).join('\n');
    const t = performance.now();
    const d = lineDiff(a, b);
    expect(performance.now() - t).toBeLessThan(500);
    expect(d.filter((l) => l.kind === 'add')).toHaveLength(80);
    expect(d.filter((l) => l.kind === 'del')).toHaveLength(80);
  });
});

describe('What changed since v2', () => {
  it('a document with an older version has it in its title row; pressed, the reader marks the added and removed lines', async () => {
    openNotes({ patch: withV2, bodies: { [OLD_ID]: OLD } });
    await settle();
    const b = toggle()!;
    expect(b.textContent).toBe('What changed since v2');
    expect(b.closest('.jp2-rv-top')).not.toBeNull();
    expect(b.getAttribute('aria-pressed')).toBe('false');
    act(() => { fireEvent.click(b); });
    await settle();
    expect(toggle()!.getAttribute('aria-pressed')).toBe('true');
    const diff = reader().querySelector<HTMLElement>('.jp2-dd')!;
    expect(diff).not.toBeNull();
    const added = [...diff.querySelectorAll('ins.jp2-dd-l')].map((x) => x.textContent);
    const removed = [...diff.querySelectorAll('del.jp2-dd-l')].map((x) => x.textContent);
    expect(added).toEqual([NOW.text.split('\n').find((l) => l.startsWith('The schedule page waits'))]);
    expect(removed).toEqual(expect.arrayContaining([expect.stringMatching(/^The schedule page loads the whole week/), '### S6: The old export button', 'It stays for admins.']));
    expect(diff.querySelector('.jp2-dd-sum')!.textContent).toBe(`Since v2: 1 line added, ${removed.length} removed`);
    // Pressed again: the document as it is.
    act(() => { fireEvent.click(toggle()!); });
    await settle();
    expect(reader().querySelector('.jp2-dd')).toBeNull();
    expect(reader().querySelector('.jp2-prose')).not.toBeNull();
  });

  it('no older version, or an older version open itself: no What changed', async () => {
    const o = openNotes();
    await settle();
    expect(toggle()).toBeNull();
    o.unmount();
    const p = openNotes({ read: { kind: 'doc', id: OLD_ID }, patch: withV2, bodies: { [OLD_ID]: OLD } });
    await settle();
    expect(reader().querySelector('.jp2-rv-meta')!.textContent).toMatch(/an older version/);
    expect(toggle()).toBeNull();
    p.unmount();
  });
});
