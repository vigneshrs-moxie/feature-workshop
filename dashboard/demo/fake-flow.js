// Invented flow facts for the demo (lib/flow.js gatherRepo's shape): no git, no network, nothing
// real. Each job's place follows its stage, and its counts come from its name, so the map looks
// the same every time. jobs: the jobs FlowWatch maps, with their stage and title.

const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const sha = (s) => hash(s).toString(16).padStart(8, '0').repeat(5);
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();

const BUILT = new Set(['implement', 'test', 'review']);

export async function fakeFlow({ repo, jobs }) {
  const name = repo.split('/').pop();
  const org = { remote: 'moxie', url: `https://github.com/acme/${name}.git`, slug: `acme/${name}` };
  const prs = [];
  let n = 140 + (hash(name) % 40);
  const facts = jobs.map((j) => {
    const h = hash(j.slug);
    const stage = j.stage ?? 'spec';
    const done = Boolean(j.closed) || stage === 'done';
    const pushed = done || BUILT.has(stage) || /^pr|staging/.test(stage);
    const f = {
      slug: j.slug, branch: j.branch ?? `feature/${j.slug}`, worktree: null, hasHead: true,
      vsMain: { ahead: done ? 0 : 1 + (h % 9), behind: h % 4 === 0 ? 2 + (h % 5) : 0 },
      vsStaging: { ahead: 1 + (h % 7), behind: 8 + (h % 6) },
      fork: pushed ? { exists: true, ahead: BUILT.has(stage) && h % 3 === 0 ? 1 + (h % 2) : 0, behind: 0 } : { exists: false },
      org: { exists: /^pr2|staging|pr3/.test(stage) || done },
      dirty: stage === 'implement' && h % 2 === 0 ? 1 + (h % 4) : 0,
    };
    const pr = (base, state, extra = {}) => prs.push({
      number: n++, title: j.title ?? j.slug, url: `https://github.com/acme/${name}/pull/${n - 1}`, state, head: f.branch, base,
      headOwner: base === f.branch ? 'you' : 'acme', review: extra.review ?? null, checks: extra.checks ?? 'passing',
      mergedAt: state === 'merged' ? ago(600) : null, mergeCommit: state === 'merged' ? sha(`${j.slug}${base}`) : null, updatedAt: ago(30),
    });
    if (stage === 'review' && h % 2 === 0) pr(f.branch, 'draft', { checks: 'pending' });
    if (stage === 'pr1') pr(f.branch, 'open', { review: 'review_required', checks: h % 2 ? 'passing' : 'failing' });
    if (/^pr2|staging|pr3/.test(stage) || done) pr(f.branch, 'merged');
    if (/^pr2/.test(stage)) pr('staging', 'open', { review: 'review_required' });
    if (/staging|pr3/.test(stage) || done) pr('staging', 'merged', { review: 'approved' });
    return f;
  });
  const inMain = {};
  for (const p of prs) if (p.state === 'merged' && p.base === 'staging') inMain[p.mergeCommit] = jobs.some((j) => j.slug && p.head === (j.branch ?? `feature/${j.slug}`) && (j.closed || j.stage === 'done'));
  prs.push({ number: n++, title: 'Release: staging → main', url: `https://github.com/acme/${name}/pull/${n - 1}`, state: 'open', head: 'staging', base: 'main', headOwner: 'acme', review: 'review_required', checks: 'passing', mergedAt: null, mergeCommit: null, updatedAt: ago(90) });
  return {
    repo, name, fetchedNow: true, org,
    fork: { remote: 'origin', url: `https://github.com/you/${name}.git`, owner: 'you' },
    main: { ref: 'moxie/main', tip: { sha: sha(`${name}main`), at: ago(26 * 60), subject: 'Release 2026.10.20 (#139)' } },
    staging: { ref: 'moxie/staging', tip: { sha: sha(`${name}staging`), at: ago(95), subject: 'Merge feature/dark-mode-toggle (#158)' }, vsMain: { ahead: 14, behind: 0 } },
    prs, inMain, jobs: facts, errors: [],
  };
}
