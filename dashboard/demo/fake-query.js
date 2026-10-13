// A pretend Foreman for demo mode. It speaks the same message protocol as the Claude Agent SDK's
// query(), asks for one permission, then moves the demo job to its next stage. No Claude, no cost.

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const STAGES = ['spec', 'refine', 'investigate', 'spec-update', 'plan', 'implement', 'test', 'review', 'pr1', 'pr2', 'staging-qa', 'pr3'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function makeFakeQuery({ featuresDir }) {
  return function fakeQuery({ prompt, options }) {
    let interrupted = false;
    const sessionId = options.resume ?? randomUUID();
    const gen = (async function* () {
      const first = await prompt[Symbol.asyncIterator]().next();
      const text = first.value?.message?.content ?? '';
      yield { type: 'system', subtype: 'init', session_id: sessionId, model: options.model ?? 'claude-fable-5-1', apiKeySource: 'none', cwd: options.cwd };
      await sleep(900);
      const slugMatch = /Private folder: (\S+)/.exec(text);
      // The job's folder: named in the message (new jobs), else the job whose status.json has this session.
      const folder = slugMatch ? slugMatch[1] : await folderForSession(featuresDir, options.resume);
      const stopping = /^Stop here/m.test(text);
      const changes = /^Please make changes/m.test(text);
      yield assistant(sessionId, stopping ? 'Understood. Recording where things stand and stopping.' : changes ? 'Got it. Sending your changes back to the crew.' : 'Got it! Checking the work before the next stage.', [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'workflow-status.md' } }]);
      await sleep(1200);
      if (interrupted) { yield result(sessionId, true); return; }

      let allowed = true;
      if (!stopping) {
        // A routine step (handled for you when routine steps run on their own)…
        await options.canUseTool('Bash', { command: 'git status --short', description: 'Check the working tree (demo)' }, { signal: new AbortController().signal, toolUseID: 't2', requestId: randomUUID() });
        // …and one that always needs your click.
        const decision = await options.canUseTool('Bash', { command: 'npm run test:db', description: 'Run the database tests (demo)' }, {
          signal: new AbortController().signal, toolUseID: 't3', requestId: randomUUID(),
          suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm run test:db' }], behavior: 'allow', destination: 'localSettings' }],
        });
        allowed = decision.behavior === 'allow';
        if (interrupted) { yield result(sessionId, true); return; }
        yield assistant(sessionId, allowed ? 'Database tests pass (12 of 12). Writing the brief.' : 'Okay, I won’t run the database tests. Noting that in the brief.');
        await sleep(1200);
      }

      // Move the demo job along so the board changes.
      const dir = folder && folder.startsWith(featuresDir) ? folder : null;
      if (dir) await advance(dir, { stopping, changes, allowed });
      const brief = stopping ? 'Stopped. Everything is recorded in workflow-status.md.' : changes ? 'Changes made. Please take another look.' : '**Next stage done.** Have a look at the brief and say go when you’re ready.';
      yield assistant(sessionId, brief);
      yield result(sessionId, false, brief);
    })();
    gen.interrupt = async () => { interrupted = true; };
    return gen;
  };
}

async function folderForSession(featuresDir, sessionId) {
  if (!sessionId) return null;
  for (const name of await fs.readdir(featuresDir).catch(() => [])) {
    try {
      const s = JSON.parse(await fs.readFile(path.join(featuresDir, name, 'status.json'), 'utf8'));
      if (s.session_id === sessionId) return path.join(featuresDir, name);
    } catch { /* no status.json */ }
  }
  return null;
}

function assistant(sessionId, text, tools = []) {
  return { type: 'assistant', parent_tool_use_id: null, session_id: sessionId, message: { id: randomUUID(), model: 'claude-fable-5-1', content: [{ type: 'text', text }, ...tools] } };
}

function result(sessionId, isError, text = '') {
  return { type: 'result', subtype: isError ? 'error_during_execution' : 'success', is_error: isError, result: text, total_cost_usd: 0.42, session_id: sessionId, permission_denials: [] };
}

async function advance(dir, { stopping, changes, allowed }) {
  const file = path.join(dir, 'status.json');
  let s = {};
  try { s = JSON.parse(await fs.readFile(file, 'utf8')); } catch { s = { schema_version: 1, slug: path.basename(dir), title: path.basename(dir), route: 'small', stage: 'spec' }; }
  const now = new Date().toISOString();
  if (stopping) {
    Object.assign(s, { stage_state: 'done', waiting_for: null, waiting_since: null, questions: [], next_proposed: 'Stopped by request', updated_at: now });
  } else {
    const ids = STAGES.filter((x) => !(s.route === 'small' && x === 'refine'));
    const next = changes ? s.stage : ids[Math.min(ids.indexOf(s.stage ?? 'spec') + 1, ids.length - 1)];
    const n = (s.brief?.number ?? 0) + 1;
    const briefPath = `briefs/${String(n).padStart(3, '0')}-${next}.md`;
    Object.assign(s, {
      stage: next, stage_state: 'waiting_for_you', waiting_for: 'approval', waiting_since: now,
      brief: { number: n, path: briefPath, headline: `${s.title} · ${next} done` },
      questions: [{ id: '1', text: 'Happy with this stage?', recommendation: 'a', options: [{ id: 'a', label: 'Yes, carry on' }, { id: 'b', label: 'Let me look first' }] }],
      next_proposed: `The stage after ${next}`, updated_at: now,
    });
    await fs.mkdir(path.join(dir, 'briefs'), { recursive: true });
    await fs.writeFile(path.join(dir, briefPath), `**${s.title} · ${next} done** (demo)\n\n**What happened**\n- The pretend crew finished the ${next} stage.\n- Tests ${allowed ? 'ran and passed' : 'were skipped because you said no'}.\n\n**Decisions for you**\n1. Happy with this stage? — Recommended: yes.\n\n**Next:** the stage after ${next}. Reply "go" to proceed.\n`);
  }
  await fs.writeFile(file, JSON.stringify(s, null, 2));
}
