// The level chip in the job header: "L2 Standard" (or "No level yet"). Its hover hint says what
// runs at that level; clicking it opens a small panel with that, what moving up or down adds or
// drops, and the four levels to switch to (POST /api/job/:slug/options, from the next stage).
// Until the job's detail has loaded the chip is off: the level shown may not be the job's yet.
import { useEffect, useRef, useState } from 'react';
import type { Job, LevelNumber } from '../../api/types';
import { isLevel, LEVEL_NUMBERS, levelChange, levelLabel, lensNames } from '../../lib/levels';
import { useWorkshopState } from '../../state/store';
import { useSetLevel } from './useSetLevel';

export function LevelChip({ job, ready = true }: { job: Job; ready?: boolean }) {
  const { meta } = useWorkshopState();
  const levels = meta?.levels;
  const names = lensNames(meta);
  const level = isLevel(job.level) ? job.level : null;
  const info = level === null ? null : levels?.find((l) => l.level === level) ?? null;
  const choice = useSetLevel(job.slug, level);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const chip = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    pop.current?.querySelector<HTMLButtonElement>('button:enabled')?.focus();
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); chip.current?.focus(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const label = level === null ? 'No level yet' : levelLabel(level, levels);
  const up = level !== null && level < 3 ? levelChange(level, (level + 1) as LevelNumber, levels, names) : null;
  const down = level !== null && level > 0 ? levelChange(level, (level - 1) as LevelNumber, levels, names) : null;
  const hint = level === null
    ? 'No level chosen yet: the Foreman suggests one in its first brief. Click to pick one.'
    : `${label}: ${info?.hint ?? ''}${up ? ` Up: ${up.text}.` : ''}${down ? ` Down: ${down.text}.` : ''} Click to change it.`;

  return (
    <div className="level-menu" ref={box}>
      <button
        ref={chip}
        type="button"
        className="chip level-chip"
        aria-haspopup="dialog"
        aria-expanded={open && ready}
        disabled={!ready}
        onClick={() => { setOpen((o) => !o); choice.clear(); }}
        title={ready ? hint : 'Loading this job… The level can be changed once it has loaded.'}
      >
        {label}
      </button>
      {open && ready && (
        <div className="level-pop" role="dialog" aria-label="This job’s level" ref={pop}>
          <p className="level-pop-now">
            <strong>{label}</strong>{info ? ` — ${info.hint}` : ' — the Foreman suggests one in its first brief, or pick one below.'}
          </p>
          {up && <p className="muted level-pop-move">Up: {up.text}.</p>}
          {down && <p className="muted level-pop-move">Down: {down.text}.</p>}
          <ul className="level-pop-list" aria-label="Switch to">
            {LEVEL_NUMBERS.map((n) => {
              const now = n === level;
              return (
                <li key={n}>
                  <button
                    type="button"
                    disabled={choice.busy || now}
                    aria-current={now ? 'true' : undefined}
                    onClick={() => void choice.set(n)}
                    title={now ? 'The level this job runs at now.' : `Run this job at ${levelLabel(n, levels)} from the next stage. ${levelChange(level, n, levels, names).text}.`}
                  >
                    {now ? `✓ ${levelLabel(n, levels)} (now)` : `Use ${levelLabel(n, levels)}`}
                  </button>
                </li>
              );
            })}
          </ul>
          {choice.done && <p className="level-done" role="status">{choice.done}</p>}
          {choice.error && <p className="field-problem" role="alert">{choice.error}</p>}
        </div>
      )}
    </div>
  );
}
