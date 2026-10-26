// A running job's time so far and how long a reply like it usually takes, for its row:
// "4m · usually 2m". Usual is the median for the reply's kind (approve, changes, message…), else
// for every kind; none when the dashboard has too few finished replies to say.
import type { Run, RunTypical } from '../api/types';

const mins = (ms: number) => {
  const m = Math.max(1, Math.round(ms / 60_000));
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`;
};

export function runTiming(run: Run | null | undefined, typical: RunTypical | null, now: Date): { text: string; hint: string; over: boolean } | null {
  if (!run || run.endedAt || !run.startedAt) return null;
  const soFar = now.getTime() - Date.parse(run.startedAt);
  if (!Number.isFinite(soFar) || soFar < 0) return null;
  const kind = typeof run.kind === 'string' ? run.kind : '';
  const usual = (kind && typical?.byKind[kind]) || typical?.all || null;
  if (!usual) return { text: mins(soFar), hint: `This reply has run ${mins(soFar)}.`, over: false };
  const over = soFar > usual * 1.5;
  return {
    text: `${mins(soFar)} · usually ${mins(usual)}`,
    hint: `This reply has run ${mins(soFar)}; a reply like it usually takes about ${mins(usual)} (the median of recent ones).${over ? ' It’s taking longer than usual.' : ''}`,
    over,
  };
}
