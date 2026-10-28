// The board and the page around it: meta, the snapshot, the job cards, replies in progress, the
// flow map, repositories, costs, past conversations and notifications. Reads, apart from the
// page's presence, the test notification and a flow refresh (this computer's own page only).

export default function boardRoutes({ read, local, events, send, sendJson, TYPES, pageMeta }) {
  const day = () => new Date().toISOString().slice(0, 10);
  const json = (path, fn) => ({ method: 'GET', path, run: async ({ res }) => sendJson(res, 200, await fn()) });
  return [
    json('/api/meta', () => read.meta(pageMeta())),
    // Notifications outside the browser: how they reach macOS here, and the last 50.
    json('/api/notifications', () => read.notifications()),
    // The flow map (Home): each repo's jobs on their way to staging and main (lib/flow.js).
    json('/api/flow', () => read.flow()),
    // Everything the new UI needs to draw itself, in one call. `seq` is the newest live event at the
    // moment the snapshot started: open /api/events?v=2&since=<seq>&epoch=<epoch> to carry on from
    // it. Events that also made it into the snapshot may arrive again; applying them twice is harmless.
    json('/api/snapshot', async () => {
      const seq = events.seq;
      return { v: 2, seq, epoch: events.epoch, ...(await read.snapshot(pageMeta())) };
    }),
    json('/api/features', () => read.features()),
    json('/api/runs', () => read.runs()),
    json('/api/repos', () => read.repos()),
    json('/api/costs', () => read.costs()),
    { method: 'GET', path: '/api/costs/export.csv', run: async ({ res }) => send(res, 200, await read.costsCsv(), TYPES['.csv'], { 'Content-Disposition': `attachment; filename="feature-costs-${day()}.csv"` }) },
    { method: 'GET', path: '/api/costs/export.md', run: async ({ res }) => send(res, 200, await read.costsMarkdown(), TYPES['.md'], { 'Content-Disposition': `attachment; filename="feature-costs-${day()}.md"` }) },
    {
      // Past Claude Code conversations, filtered before the list is cut, so searching reaches every one.
      method: 'GET', path: '/api/history',
      run: async ({ res, url }) => {
        const p = url.searchParams;
        return sendJson(res, 200, await read.history({ q: p.get('q'), repo: p.get('repo'), linked: p.get('linked'), dashboard: p.get('dashboard'), test: p.get('test') }));
      },
    },
    { method: 'GET', path: /^\/api\/history\/([0-9a-f-]{36})$/, run: async ({ res, m }) => sendJson(res, 200, await read.historyDetail(m[1])) },
    {
      // The page is visible: notifications that it shows anyway don't pop on macOS meanwhile.
      method: 'POST', path: '/api/presence',
      run: ({ res, body }) => { local.presence(body.visible); return sendJson(res, 200, { ok: true }); },
    },
    { method: 'POST', path: '/api/notifications/test', run: async ({ res }) => sendJson(res, 200, await local.testNotification()) },
    // Fetch both remotes and read the PRs now (read-only), instead of waiting for the next 10-minute refresh.
    { method: 'POST', path: '/api/flow/refresh', run: ({ res }) => sendJson(res, 202, local.refreshFlow()) },
  ];
}
