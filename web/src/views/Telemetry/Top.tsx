// The top of Telemetry: the two limits as dials (each split into this app's use and Other use, so
// each part reads), the "Who used this week's limit" line with its note, and the next-step bar
// with Read now. Status is a word and an icon (⚠ near the limit, ⛔ at it), never colour alone.
import { useId, type ReactNode } from 'react';
import type { LimitSplit, UsageMeter } from '../../api/types';
import { WARN_AT } from '../../components/UsageMeters';
import { ONE, OTHER_SLOT, pct, slotClass } from './words';
import { ShareBar } from './charts';
import { More } from '../../components/More';

const CX = 80;
const CY = 76;
const R = 62;
const at = (f: number) => [CX - R * Math.cos(Math.PI * f), CY - R * Math.sin(Math.PI * f)] as const;
const arc = (f0: number, f1: number) => {
  const [x0, y0] = at(Math.max(0, f0));
  const [x1, y1] = at(Math.min(1, f1));
  return `M${x0.toFixed(1)},${y0.toFixed(1)} A${R},${R} 0 0 1 ${x1.toFixed(1)},${y1.toFixed(1)}`;
};
const tick = (f: number) => { const [x0, y0] = at(f); const k = (R + 12) / R; return `M${x0.toFixed(1)},${y0.toFixed(1)} L${(CX + (x0 - CX) * k).toFixed(1)},${(CY + (y0 - CY) * k).toFixed(1)}`; };

export const levelOf = (percent: number) => (percent >= 100 ? 'full' : percent >= WARN_AT ? 'warn' : 'ok');

/** One limit as a dial: this app's part, then Other use (its own pattern), with marks at 80 and 90. */
export function Dial({ name, meter, split, when, unread = 'Not read yet' }: { name: string; meter: UsageMeter | null; split: LimitSplit; when: string; unread?: string }) {
  const id = useId().replace(/:/g, '');
  if (!meter) {
    return (
      <div className="tele-dial is-unread" data-dial={name}>
        <svg viewBox="0 0 160 92" width="160" height="92" aria-hidden="true"><path d={arc(0, 1)} className="tele-dial-track" /></svg>
        <div><div className="tele-dial-name">{name}</div><div className="tele-dial-sub muted">{unread}</div></div>
      </div>
    );
  }
  const level = levelOf(meter.percent);
  const split2 = split.state === 'split' && split.app !== null && split.other !== null;
  const app = split2 ? split.app! / 100 : meter.percent / 100;
  const other = split2 ? split.other! / 100 : 0;
  const unknown = split2 ? (split.unknown ?? 0) / 100 : 0;
  const words = level === 'full' ? 'Full' : `${pct(meter.percent)}`;
  return (
    <div className={`tele-dial is-${level}`} data-dial={name}>
      <svg viewBox="0 0 160 92" width="160" height="92" aria-hidden="true">
        <defs>
          <pattern id={`${id}-o`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" className="tele-pat-fill" /><line x1="0" y1="0" x2="0" y2="6" className="tele-pat-ink" />
            <line x1="3" y1="0" x2="3" y2="6" className="tele-pat-ink is-thin" />
          </pattern>
        </defs>
        <path d={arc(0, 1)} className="tele-dial-track" />
        {app > 0 && <path d={arc(0, app)} className={`tele-dial-part ${split2 ? 'is-app' : `is-all is-${level}`}`} />}
        {other > 0 && <path d={arc(app, app + other)} className="tele-dial-part is-other" style={{ stroke: `url(#${id}-o)` }} />}
        {unknown > 0.005 && <path d={arc(app + other, app + other + unknown)} className="tele-dial-part is-unknown" />}
        <path d={tick(0.8)} className="tele-dial-mark" />
        <path d={tick(0.9)} className="tele-dial-mark" />
        <text x="16" y="90" className="tele-dial-end">0</text>
        <text x="132" y="90" className="tele-dial-end">100</text>
      </svg>
      <div>
        <div className="tele-dial-num">{level === 'warn' && <span aria-hidden="true">⚠ </span>}{level === 'full' && <span aria-hidden="true">⛔ </span>}{words}<span className="sr-only">{level === 'full' ? ' (limit reached)' : level === 'warn' ? ' used (near the limit)' : ' used'}</span></div>
        <div className="tele-dial-name">{name}</div>
        <div className="tele-dial-sub muted">{when}</div>
        {split2 && (
          <div className="tele-dial-parts">
            <span><span className={`tele-swatch ${ONE}`} aria-hidden="true" />In this app {pct(split.app!)}</span>
            <span><span className={`tele-swatch ${slotClass(OTHER_SLOT)}`} aria-hidden="true" />Other use {pct(split.other!)}, estimated</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** "Who used this week's limit": one segment per person in this app, then Other use, then what's free. */
export function WhoLine({ split, note, onPick }: { split: LimitSplit; note: string; onPick: (who: string) => void }) {
  let body: ReactNode;
  if (split.state === 'split') {
    const parts = [
      ...split.people.map((p, i) => ({ key: p.user, label: p.user, slot: Math.min(7, i + 1), percent: p.percent, words: `${p.user}: ${pct(p.percent)} of this week’s limit, in this app` })),
      { key: '~other', label: 'Other use (estimated)', slot: OTHER_SLOT, percent: split.other ?? 0, words: `Other use: ${pct(split.other ?? 0)} of this week’s limit, estimated` },
    ];
    body = <ShareBar parts={parts} unknown={split.unknown ?? 0} free={split.free ?? 0} label="Who used this week’s limit" onPick={onPick} />;
  } else {
    body = <p className="tele-who-say">{split.sentence}</p>;
  }
  return (
    <section className="tele-who" aria-labelledby="tele-who-title">
      <h3 id="tele-who-title" className="tele-who-title">Who used this week’s limit</h3>
      {body}
      <More screen="telemetry" id="who-how" label="How this is worked out" icon="help" className="tele-who-how">
        <p className="tele-who-note muted">{note}</p>
      </More>
    </section>
  );
}
