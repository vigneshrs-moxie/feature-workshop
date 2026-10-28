// Settings → Repos: the repositories Ground Control knows and the profile each one follows
// (lib/repos.js, lib/profile.js). The registry is the runner's (it reads git), so these routes reach it
// through runner.local.repos, a small door with list, add, remove and check.
//   GET    /api/repos/registry                     every registered repository, its profile and its errors
//   POST   /api/repos/registry  { path, profileFile? }   register one (400 with the profile's errors)
//   DELETE /api/repos/registry?path=…              forget one (its folder and profile are left alone)
//   POST   /api/repos/registry/check { path?, profileFile? }  read a profile and say what is wrong with it

import { HttpError } from '../lib/http-guard.js';

const NOT_READY = 'This copy of Ground Control can’t read the repository list yet. Restart it, and if this stays, tell whoever looks after it.';

export default function reposRoutes({ local, str, sendJson }) {
  const door = () => {
    const repos = local?.repos;
    if (!repos) throw new HttpError(503, NOT_READY);
    return repos;
  };
  const pathOf = (v) => str(v, 4096).trim();
  return [
    { method: 'GET', path: '/api/repos/registry', run: async ({ res }) => sendJson(res, 200, await door().list()) },
    {
      method: 'POST', path: '/api/repos/registry',
      run: async ({ res, body }) => {
        const p = pathOf(body.path);
        if (!p) throw new HttpError(400, 'Give the repository’s folder.');
        const r = await door().add({ path: p, profileFile: pathOf(body.profileFile) || null });
        if (!r.ok) return sendJson(res, 400, { error: r.errors?.[0] ?? 'That repository couldn’t be added.', errors: r.errors ?? [], warnings: r.warnings ?? [] });
        return sendJson(res, 200, { ...r, ...(await door().list()) });
      },
    },
    {
      method: 'DELETE', path: '/api/repos/registry',
      run: async ({ res, url, body }) => {
        const p = pathOf(url.searchParams.get('path')) || pathOf(body?.path);
        if (!p) throw new HttpError(400, 'Say which repository to forget.');
        const r = await door().remove(p);
        if (!r.ok) return sendJson(res, 400, { error: r.errors?.[0] ?? 'That repository couldn’t be forgotten.', errors: r.errors ?? [] });
        return sendJson(res, 200, { ...r, ...(await door().list()) });
      },
    },
    {
      method: 'POST', path: '/api/repos/registry/check',
      run: async ({ res, body }) => {
        const p = pathOf(body.path);
        const profileFile = pathOf(body.profileFile);
        if (!p && !profileFile) throw new HttpError(400, 'Give the repository’s folder or a profile file to check.');
        return sendJson(res, 200, await door().check({ path: p || null, profileFile: profileFile || null }));
      },
    },
  ];
}
