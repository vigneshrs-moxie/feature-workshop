// Detail on request (packet R): the labelled disclosures every screen folds its extras behind, so a
// screen shows what is happening, what needs you and the one next step first.
//   <More>        "Details ⌄", "History (4) ⌄", "More graphs (7) ⌄": a quiet row that opens the
//                 rest below it, inside its own column, so nothing in another column moves. Open
//                 or closed is remembered per screen in this browser (app/detail.ts), and starts
//                 open with Settings → Look → Detail: Full.
//   <HiddenSlot>  what stays where a hidden thing was: one slim row of a fixed height ("Rework,
//                 hidden · Show"), so the things around it keep their places.
import { useId, type ReactNode } from 'react';
import { useShown } from '../app/detail';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';

export function More({ screen, id, label, count, note, icon, simpleOpen = false, className = '', children, open: forced, onOpen }: {
  /** The screen it is on (jobs, job, desk, stage, telemetry, settings…): remembered per screen. */
  screen: string;
  id: string;
  label: string;
  /** "(4)" after the label: how many things are inside. */
  count?: number;
  /** A short muted note after the label, said in words. */
  note?: ReactNode;
  icon?: IconName;
  /** Starts open even in Simple. */
  simpleOpen?: boolean;
  className?: string;
  children: ReactNode;
  /** Opened from outside (a link to something inside it); it stays open until closed. */
  open?: boolean;
  onOpen?: (open: boolean) => void;
}) {
  const [stored, setStored] = useShown(screen, id, simpleOpen);
  const open = forced || stored;
  const uid = useId();
  const toggle = () => { setStored(!open); onOpen?.(!open); };
  return (
    <section className={`more${open ? ' is-open' : ''} ${className}`.trim()} aria-label={label}>
      <button type="button" className="more-head" aria-expanded={open} aria-controls={`${uid}-body`} onClick={toggle} title={open ? `Hide ${label.toLowerCase()}.` : `Show ${label.toLowerCase()}.`}>
        {icon && <Icon name={icon} size={16} className="more-icon" />}
        <span className="more-label">{label}</span>
        {count !== undefined && <span className="more-count num">{count}</span>}
        {note !== undefined && note !== null && <span className="more-note">{note}</span>}
        <Icon name="chevron-down" size={14} className="more-chevron" />
      </button>
      {open && <div className="more-body" id={`${uid}-body`}>{children}</div>}
    </section>
  );
}

/** The slim row that keeps a hidden thing's place: its name, "hidden", and Show. */
export function HiddenSlot({ name, onShow, className = '' }: { name: string; onShow(): void; className?: string }) {
  return (
    <div className={`hidden-slot ${className}`.trim()} role="group" aria-label={`${name}, hidden`}>
      <Icon name="eye-off" size={14} />
      <span className="hidden-slot-name">{name}</span>
      <span className="hidden-slot-word">hidden</span>
      <Button kind="quiet" size="sm" className="hidden-slot-show" onClick={onShow} title={`Show ${name} again, in the same place.`}>Show</Button>
    </div>
  );
}
