// @vitest-environment node
// The made-up long job as the web sees it (written from dashboard/test/fixtures/long-job.js): it
// loads, its counts are the ones the server fixture holds, and only tests import it, so neither
// size ends up in the app's bundle.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { longJob } from './longJob';
import { longJob200 } from './longJob200';

const SRC = fileURLToPath(new URL('../..', import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('the long job fixture', () => {
  for (const [size, job] of [[52, longJob], [200, longJob200]] as const) {
    it(`${size} items: lines, kinds, steps, PRs and a body for every line`, () => {
      const { counts, payload, bodies, commits } = job;
      expect(counts.items).toBe(size);
      expect(payload.thread).toHaveLength(size);
      const kinds = (k: string) => payload.thread.filter((l) => l.kind === k).length;
      expect([kinds('reply'), kinds('you'), kinds('brief'), kinds('small')]).toEqual([counts.replies, counts.you, counts.briefs, counts.small]);
      expect(payload.steps.map((s) => s.id)).toEqual(['spec', 'investigate', 'plan', 'build', 'test', 'review', 'ship']);
      expect(payload.prs).toHaveLength(3);
      expect(commits).toHaveLength(counts.commits);
      for (const l of payload.thread) {
        expect(bodies[l.id]?.kind).toBe(l.kind);
        expect(bodies[l.id].meta.hash).toBe(l.hash);
      }
      const docs = payload.steps.flatMap((s) => s.outputs.filter((o) => o.kind === 'doc'));
      for (const d of docs) expect(bodies[d.id]?.kind).toBe('doc');
    });
  }

  it('is imported by tests only', () => {
    const importers = files(SRC)
      .filter((f) => !/\.test\.tsx?$/.test(f) && !f.includes(join('jobpage', 'fixtures')))
      .filter((f) => /from ['"][^'"]*fixtures\/longJob/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f));
    expect(importers).toEqual([]);
  });
});
