// Settings, simple first (packet R): each section shows its main choices, then one labelled More that
// names what is inside it ("More: text size, layouts, play"), remembered per browser like every other
// More (app/detail.ts; Settings → Look → Detail: Full starts them open). "Find a setting" can land on
// a control inside a closed More: the More opens by itself (and stays open), so the control is
// there to be ringed.
import { createContext, useContext, useEffect, useId, type ReactNode } from 'react';
import './settings.css';
import { useShown } from '../../app/detail';
import { More } from '../../components/More';

/** The data-setting id "Find a setting" is showing right now, if any (SettingsView provides it). */
export const FoundSetting = createContext<string | null>(null);

export function SettingsMore({ id, label, holds, simpleOpen = false, note, count, className = '', children }: {
  id: string;
  /** "More: …", naming what is inside. */
  label: string;
  /** The data-setting ids of the controls inside, so a find opens it. */
  holds: readonly string[];
  simpleOpen?: boolean;
  note?: ReactNode;
  count?: number;
  className?: string;
  children: ReactNode;
}) {
  const found = useContext(FoundSetting);
  const [open, setOpen] = useShown('settings', id, simpleOpen);
  const wanted = found !== null && holds.includes(found);
  useEffect(() => { if (wanted && !open) setOpen(true); }, [wanted, open, setOpen]);
  return (
    <More screen="settings" id={id} label={label} note={note} count={count} simpleOpen={simpleOpen} className={`settings-more ${className}`.trim()}>
      {children}
    </More>
  );
}

/** A section's heading with its Saved note beside it (for choices whose cards have no heading of their own). */
export function SectionHead({ children, saved, title }: { children: ReactNode; saved?: ReactNode; title?: string }) {
  return <div className="settings-head"><h3 className="settings-heading" title={title}>{children}</h3>{saved}</div>;
}

/**
 * A group of choices with a visible heading and, beside the heading, its Saved note. The heading
 * names the group (aria-labelledby), so the note is never part of the group's name.
 */
export function SettingGroup({ title, setting, saved, className = '', disabled, hint, children }: {
  title: ReactNode;
  setting: string;
  saved?: ReactNode;
  className?: string;
  disabled?: boolean;
  /** The group's tooltip. */
  hint?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <fieldset className={`setting-group ${className}`.trim()} data-setting={setting} disabled={disabled} aria-labelledby={id} title={hint}>
      <div className="setting-head"><span id={id} className="look-heading">{title}</span>{saved}</div>
      {children}
    </fieldset>
  );
}
