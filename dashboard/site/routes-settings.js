// Settings and the usage limit: your settings, "Always allow" rules, the usage meters and
// "Carry on now". Each change is one command to the runner (lib/protocol.js).

export default function settingsRoutes({ runner, read, local, str, sendJson, LOCAL }) {
  const command = async (res, c) => sendJson(res, 200, await runner.handle(c, LOCAL));
  return [
    {
      method: 'POST', path: '/api/settings',
      run: ({ res, body }) => {
        const { notify, workflow, play, policy } = body;
        return command(res, { type: 'settings', notify, workflow, play, policy, recheckAuto: body.recheckAuto === true ? true : undefined });
      },
    },
    { method: 'POST', path: '/api/usage/resume', run: ({ res }) => command(res, { type: 'usage-resume' }) },
    // The top bar's usage meters: read the plan's usage now instead of at the next minute.
    { method: 'POST', path: '/api/usage/check', run: async ({ res }) => sendJson(res, 200, await local.checkPlanUsage()) },
    { method: 'POST', path: '/api/usage/auto', run: ({ res, body }) => command(res, { type: 'settings', autoResume: body.on === true }) },
    // Your "Always allow" rules. active: false while your (global) setting is "ask about everything".
    { method: 'GET', path: '/api/rules', run: async ({ res }) => sendJson(res, 200, await read.rules()) },
    // "Always allow…": save a rule you confirmed, and (with permissionId) allow the request it was drafted from.
    { method: 'POST', path: '/api/rules', run: ({ res, body }) => command(res, { type: 'rules', action: 'add', rule: body.rule, permissionId: str(body.permissionId, 100) || null }) },
    { method: 'DELETE', path: /^\/api\/rules\/([\w-]{1,100})$/, run: ({ res, m }) => command(res, { type: 'rules', action: 'remove', id: m[1] }) },
  ];
}
