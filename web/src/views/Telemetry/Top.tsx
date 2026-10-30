// The top of Telemetry: the two limits as dials (each split into this app's use, your Claude Code
// use outside it when that is counted, and Other use, so each part reads), the "Who used this week's
// limit" line with its note, and the next-step bar with Read now. Status is a word and an icon (⚠ near
// the limit, ⛔ at it), never colour alone. Your Claude Code part (packet U) is the same hue as its
// person or the dial's, washed and dotted (Telemetry.css .tele-cc), and always named in words.
import { useId, type ReactNode } from 'react';
import type { ClaudeCodeUse, LimitSplit, UsageMeter } from '../../api/types';
import { WARN_AT } from '../../components/UsageMeters';
import { Icon } from '../../components/Icon';
import { CC, ONE, OTHER_SLOT, pct, slotClass } from './words';
import { limitParts, ShareBar } from './charts';
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
export function Dial({ name, meter, split, when, unread = 'Not read yet', claudeCode }: { name: string; meter: UsageMeter | null; split: LimitSplit; when: string; unread?: string; claudeCode?: ClaudeCodeUse }) {
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
  // Your Claude Code use outside this app: its own slice once it is read; while it reads, its line keeps its place.
  const counted = split2 && typeof split.claudeCode === 'number';
  const cc = counted ? split.claudeCode! / 100 : 0;
  const ccReading = split2 && !counted && claudeCode?.state === 'reading';
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
          {counted && (
            <pattern id={`${id}-c`} width="5" height="5" patternUnits="userSpaceOnUse">
              <rect width="5" height="5" className="tele-cc-fill" /><circle cx="2.5" cy="2.5" r="1.5" className="tele-cc-dot" />
            </pattern>
          )}
        </defs>
        <path d={arc(0, 1)} className="tele-dial-track" />
        {app > 0 && <path d={arc(0, app)} className={`tele-dial-part ${split2 ? 'is-app' : `is-all is-${level}`}`} />}
        {cc > 0 && <path d={arc(app, app + cc)} className="tele-dial-part is-cc" style={{ stroke: `url(#${id}-c)` }} />}
        {other > 0 && <path d={arc(app + cc, app + cc + other)} className="tele-dial-part is-other" style={{ stroke: `url(#${id}-o)` }} />}
        {unknown > 0.005 && <path d={arc(app + cc + other, app + cc + other + unknown)} className="tele-dial-part is-unknown" />}
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
            {counted && <span><span className={`tele-swatch ${ONE} ${CC}`} aria-hidden="true" />In Claude Code {pct(split.claudeCode!)}</span>}
            {ccReading && <span className="tele-cc-reading"><span className="tele-swatch tele-reading" aria-hidden="true" />In Claude Code: reading…</span>}
            <span><span className={`tele-swatch ${slotClass(OTHER_SLOT)}`} aria-hidden="true" />Other use {pct(split.other!)}, estimated</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** "Who used this week's limit": one segment per person (in this app, and in Claude Code when it is counted), then Other use, then what's free. */
export function WhoLine({ split, note, otherLabel, me = null, claudeCode, onPick }: { split: LimitSplit; note: string; otherLabel?: string; me?: string | null; claudeCode?: ClaudeCodeUse; onPick: (who: string) => void }) {
  let body: ReactNode;
  if (split.state === 'split') {
    const parts = limitParts({
      people: split.people.map((p) => ({ user: p.user, percent: p.percent, claudeCode: typeof split.claudeCode === 'number' ? p.claudeCode ?? 0 : undefined })),
      other: split.other ?? 0, otherLabel, me, claudeCode, meterWords: 'of this week’s limit',
    });
    body = <ShareBar parts={parts} unknown={split.unknown ?? 0} free={split.free ?? 0} label="Who used this week’s limit" onPick={(key) => onPick(key.replace(/~cc$/, ''))} />;
  } else {
    body = (
      <>
        <p className="tele-who-say">{split.sentence}</p>
        {claudeCode?.state === 'reading' && <p className="tele-cc-line muted" role="status"><Icon name="loader" size={14} />{claudeCode.words}</p>}
      </>
    );
  }
  return (
    <section className="tele-who" aria-labelledby="tele-who-title">
      <h3 id="tele-who-title" className="tele-who-title">Who used this week’s limit</h3>
      {body}
      {claudeCode?.state === 'error' && <p className="tele-cc-line" role="status"><Icon name="warn" size={14} />{claudeCode.words}</p>}
      <More screen="telemetry" id="who-how" label="How this is worked out" icon="help" className="tele-who-how">
        {claudeCode && claudeCode.state !== 'error' && <p className="tele-who-note muted">{claudeCode.words}</p>}
        <p className="tele-who-note muted">{note}</p>
        {/* Counted: Other use's note already says what can't be seen. */}
        {claudeCode && !claudeCode.counted && (claudeCode.state === 'reading' || claudeCode.state === 'error') && <p className="tele-who-note muted">{claudeCode.note}</p>}
      </More>
    </section>
  );
}
