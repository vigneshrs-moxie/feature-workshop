// A made-up laptop for the full-mirror tests (packet 2B): a pretend runner with the reads the
// mirror sends up (the snapshot, a job's page, its documents, decisions and evidence, a stack), a
// gate that moves on when you approve it, a waiting permission, and the laptop's own audit lines.
// Nothing real runs.

import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { createSiteLink, siteTokenStore, writeSiteFile } from '../../dashboard/runner/site-link.js';
import { SITE } from './helpers.js';
import { tmp } from './laptops.js';

export const gate = (n, extra = {}) => ({ briefNumber: n, briefFile: `briefs/00${n}-plan.md`, headline: `Plan v${n} ready`, stage: 'plan', nextStage: 'implement', questions: [], decided: [], raisedVersions: { plan: String(n) }, stale: false, ...extra });

export function mirrorRunner({ slug = 'add-export', title = 'Add export' } = {}) {
  const ee = new EventEmitter();
  const auditLines = [];
  const r = {
    handled: [], auditLines,
    job: {
      slug, title, stage: 'plan', stageState: 'waiting', needsYou: true, lane: 'needs-you', group: 'needs-you', laneReason: 'Needs you: the plan',
      gate: gate(2), branch: `feature/${slug}`, cost: { totalUsd: 1.5, source: 'estimate' },
      thread: [
        { id: 'brief:briefs/002-plan.md', kind: 'brief', at: '2026-10-30T15:00:00.000Z', number: 2, stage: 'plan', file: 'briefs/002-plan.md', headline: 'Plan v2 ready' },
        { id: 'reply:abc', kind: 'reply', at: '2026-10-30T15:01:00.000Z', html: '<pre>const secret = readSource();</pre>' },
        { id: 'you:def', kind: 'you', at: '2026-10-30T15:02:00.000Z', text: 'Looks good' },
      ],
      audit: [{ action: 'send', text: 'private words' }],
      lastReply: { html: '<p>the Foreman’s last words</p>' },
      runs: [{ id: 'run-1', status: 'done', text: 'streamed words', lastText: 'more words' }],
      permissionsPending: [],
      activity: [{ who: 'planner', state: 'done' }],
      history: [], briefs: [{ number: 2, file: 'briefs/002-plan.md' }],
    },
    permissions: [],
    docs: [{ file: 'briefs/002-plan.md', name: 'Brief #2 · plan', group: 'briefs', updatedAt: '2026-10-30T15:00:00.000Z' }],
    docText: { 'briefs/002-plan.md': '# Plan v2\n\nThe plan.' },
    evidence: null,
    evidenceDir: null,
    stack: null,
    online: true,
    read: {
      snapshot: async () => ({
        meta: { token: 'local-page-token-should-not-go', featuresDir: '/home/someone/feature-work', stages: [], settings: { policy: 'hands-off' } },
        jobs: r.job ? [{ ...cardOf(r.job) }] : [], permissions: r.permissions, usage: { limited: false }, planUsage: null, runTypical: null, generatedAt: '2026-10-30T15:00:00.000Z',
      }),
      features: async () => ({ features: r.job ? [cardOf(r.job)] : [] }),
      job: async (s) => { if (!r.job || s !== r.job.slug) throw Object.assign(new Error('No job by that name.'), { status: 404 }); return { ...r.job, permissionsPending: r.permissions }; },
      docs: async () => ({ docs: r.docs }),
      doc: async (_s, file) => ({ file, name: file, type: 'md', html: `<p>${r.docText[file] ?? ''}</p>`, text: r.docText[file] ?? '', updatedAt: '2026-10-30T15:00:00.000Z', size: 10, vscode: '/home/someone/x.md', summary: null }),
      decisions: async () => ({ decisions: [{ id: 'D1', question: 'Which format?', choice: 'CSV' }] }),
      runs: async () => ({ runs: [], permissions: r.permissions }),
    },
    local: {
      evidence: {
        view: async () => (r.evidence ? { evidence: r.evidence, commit: 'abc1234', wanted: true, why: null, recording: false, problem: null, folder: '/home/someone/ev', folderUrl: 'file:///home/someone/ev/' } : null),
        file: async (_s, rel) => { const abs = path.join(r.evidenceDir, rel); const st = fs.statSync(abs); return { abs, type: 'image/png', size: st.size }; },
      },
      stacks: {
        list: async () => ({ stacks: r.stack ? [{ slug: r.stack.slug, title: r.stack.title, phase: 'merge', steps: [], parts: 1, counts: {}, sections: [] }] : [] }),
        view: async (s) => ({ slug: s, title: r.stack?.title, phase: 'merge', parts: [], sections: [] }),
      },
    },
    async handle(cmd) {
      r.handled.push(cmd);
      if (cmd.type === 'approve' || cmd.type === 'send-back') {
        // The Foreman moves on: the next stage, no gate.
        r.job = { ...r.job, gate: null, stage: cmd.type === 'approve' ? 'implement' : 'plan', needsYou: false, lane: 'working', group: 'working', laneReason: 'Working' };
        r.changed();
      }
      if (cmd.type === 'allow' || cmd.type === 'deny') { r.permissions = r.permissions.filter((p) => p.id !== cmd.requestId); r.changed(); }
      if (cmd.type === 'fetch-diff') return { dir: '/x', diff: '+ a line of code\n- another' };
      return { ok: true };
    },
    on(type, fn) { ee.on(type, fn); return () => ee.off(type, fn); },
    changed(job = r.job?.slug ?? null) { ee.emit('change'); ee.emit('*', 'thread', job); },
    audit: async (line) => { auditLines.push(line); },
  };
  return r;
}

export function cardOf(job) {
  const { thread, audit, lastReply, runs, permissionsPending, gate: g, ...card } = job;
  return card;
}

/** The laptop's link to the in-process site, with the mirror runner. */
export async function mirrorLaptop(s, token, { runner = mirrorRunner(), stateDir = tmp(), waitSeconds = 1, log = () => {}, fetch = s.fetch } = {}) {
  writeSiteFile(stateDir, { url: SITE, deviceId: 'device-test-0002', runnerId: 1, name: 'Test Laptop', person: { name: 'Olive Owner' } });
  const store = await siteTokenStore({ stateDir, prefer: 'file' });
  await store.set(token);
  const link = createSiteLink({ runner, stateDir, store, fetch, waitSeconds, debounceMs: 20, watchEveryMs: 0, log, version: '0.1.0', audit: runner.audit, putFile: s.fetch });
  return { link: link.start(), runner, stateDir, store };
}
