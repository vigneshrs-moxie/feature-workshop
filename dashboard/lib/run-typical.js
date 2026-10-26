// How long a Foreman reply usually takes, for the "about 12m left" on running rows. Read from the
// audit: each reply's 'send' (with its kind: approve, changes, message, nudge…) paired by runId with
// its 'run-ended'. Only replies that finished normally count; stopped, failed and limit-paused ones
// don't. The median of the newest MAX of each kind, and of all kinds together; a kind with fewer
// than MIN finished replies has no estimate of its own (the page falls back to all kinds). Pure.

export const MIN = 3;
export const MAX = 40;

const median = (xs) => {
  if (xs.length < MIN) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return Math.round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
};

/** { all: ms | null, byKind: { [kind]: ms } } */
export function typicalRuns(audit = []) {
  const started = new Map();
  const done = []; // { kind, ms }, oldest first
  for (const e of audit) {
    if (!e?.runId) continue;
    if (e.action === 'send') started.set(e.runId, { kind: e.kind ?? 'message', at: Date.parse(e.at) });
    else if (e.action === 'run-ended' && e.status === 'done') {
      const s = started.get(e.runId);
      const ms = s ? Date.parse(e.at) - s.at : NaN;
      if (Number.isFinite(ms) && ms > 0) done.push({ kind: s.kind, ms });
      started.delete(e.runId);
    }
  }
  const byKind = {};
  for (const kind of new Set(done.map((d) => d.kind))) {
    const m = median(done.filter((d) => d.kind === kind).slice(-MAX).map((d) => d.ms));
    if (m !== null) byKind[kind] = m;
  }
  return { all: median(done.slice(-MAX).map((d) => d.ms)), byKind };
}
