// The job drawer: a job's notes (notes.md) and its options, from the right edge. Opened from the
// job menu ("Notes and options") and ⌘K ("Job notes and options"). Both tabs stay mounted while it
// is open, so switching keeps what you typed; closing with unsaved changes asks first.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Job } from '../../api/types';
import type { DrawerTab } from '../../app/ui';
import { Drawer } from '../../components/Drawer';
import { HowThisWorks } from '../../components/HowThisWorks';
import { optionLists } from '../../lib/jobOptions';
import { isLevel } from '../../lib/levels';
import { useWorkshopState } from '../../state/store';
import { NotesEditor } from './NotesEditor';
import { OptionsEditor } from './OptionsEditor';

const TABS: { id: DrawerTab; label: string; hint: string }[] = [
  { id: 'notes', label: 'Notes', hint: 'This job’s notes.md: guidance the Foreman reads at the start of every session.' },
  { id: 'options', label: 'Options', hint: 'How much process this job gets: level, stages, reviewers, testing, Fable second looks and models.' },
];

// Opened from the job menu or ⌘K, both gone by now: focus goes back to the job menu's button.
const menuButton = () => document.querySelector<HTMLElement>('.job-menu > button');

export function JobDrawer({ slug, job, tab = 'notes', onClose }: { slug: string; job: Job | null; tab?: DrawerTab; onClose: () => void }) {
  const { meta } = useWorkshopState();
  const [current, setCurrent] = useState<DrawerTab>(tab);
  const [dirty, setDirty] = useState<Record<DrawerTab, boolean>>({ notes: false, options: false });
  const [confirm, setConfirm] = useState(false);
  const keep = useRef<HTMLButtonElement>(null);
  const tabRefs = useRef<Record<DrawerTab, HTMLButtonElement | null>>({ notes: null, options: null });
  const onNotesDirty = useCallback((d: boolean) => setDirty((x) => (x.notes === d ? x : { ...x, notes: d })), []);
  const onOptionsDirty = useCallback((d: boolean) => setDirty((x) => (x.options === d ? x : { ...x, options: d })), []);
  const unsaved = TABS.filter((t) => dirty[t.id]).map((t) => t.label.toLowerCase());

  // The question takes focus; when it goes away, focus goes back to the tab you were on.
  const asked = useRef(false);
  useEffect(() => {
    if (confirm) keep.current?.focus();
    else if (asked.current) tabRefs.current[current]?.focus();
    asked.current = confirm;
  }, [confirm, current]);
  useEffect(() => { if (confirm && !unsaved.length) setConfirm(false); }, [confirm, unsaved.length]);

  const requestClose = () => {
    if (confirm) setConfirm(false); // Escape on the question: keep editing
    else if (unsaved.length) setConfirm(true);
    else onClose();
  };

  function onTabKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = TABS[(TABS.findIndex((t) => t.id === current) + 1) % TABS.length].id;
    setCurrent(next);
    tabRefs.current[next]?.focus();
  }

  const title = job?.title || slug;
  const head = (
    <>
      <p className="muted drawer-job">{title}</p>
      <div className="drawer-tabs" role="tablist" aria-label="Notes and options">
        {TABS.map((t) => (
          <button
            key={t.id}
            ref={(el) => { tabRefs.current[t.id] = el; }}
            type="button"
            role="tab"
            id={`drawer-tab-${t.id}`}
            aria-selected={current === t.id}
            aria-controls={`drawer-panel-${t.id}`}
            tabIndex={current === t.id ? 0 : -1}
            className="drawer-tab"
            onClick={() => setCurrent(t.id)}
            onKeyDown={onTabKey}
            title={t.hint}
            data-autofocus={current === t.id ? true : undefined}
          >
            {t.label}{dirty[t.id] && <>{' '}<span className="drawer-dot" aria-hidden="true">•</span><span className="sr-only">(unsaved changes)</span></>}
          </button>
        ))}
      </div>
      {confirm && (
        <div className="drawer-confirm perm-warn" role="alert">
          <p>Your {unsaved.join(' and ')} have unsaved changes. Close without saving?</p>
          <div className="drawer-confirm-actions">
            <button ref={keep} type="button" className="btn" onClick={() => setConfirm(false)} title="Go back to the drawer; nothing is lost.">Keep editing</button>
            <button type="button" className="btn btn-danger" onClick={onClose} title="Close the drawer and throw away the changes you haven’t saved.">Discard and close</button>
          </div>
        </div>
      )}
    </>
  );

  return (
    <Drawer title="Notes and options" onRequestClose={requestClose} className="job-drawer" head={head} fallbackFocus={menuButton}>
      <section id="drawer-panel-notes" role="tabpanel" aria-label="Notes" hidden={current !== 'notes'}>
        <NotesEditor slug={slug} max={optionLists(meta).notesMax} onDirtyChange={onNotesDirty} />
      </section>
      <section id="drawer-panel-options" role="tabpanel" aria-label="Options" hidden={current !== 'options'}>
        <OptionsEditor slug={slug} level={isLevel(job?.level) ? job.level : null} stage={job?.stage ?? null} onDirtyChange={onOptionsDirty} />
      </section>
      <HowThisWorks id="job-drawer" defaultOpen={false}>
        <p><strong>Notes</strong> are this job’s <code>notes.md</code>. The Foreman reads them at the start of every session, so they are the place for lasting guidance: what to keep, what to avoid, who to ask. They shape how it works; they never approve anything. They are written in Markdown: <strong>Preview</strong> shows them as a clean page, as you have them now, without saving.</p>
        <p><strong>Options</strong> set how much process the job gets: its level, the stages it skips, the review lenses and fix rounds, whether you test it yourself, where Fable takes a second look, and the models. They choose process, never permission: what the Foreman may do without asking is the permission setting (job menu or Settings), and every plan still comes to you for approval.</p>
        <p>Saved options apply from the next stage; a worker already running finishes first. Documents you provided are listed here; adding or changing them is still on the job’s classic page.</p>
        <p>The Foreman’s model is shown but not changed here: it was set when the job started, and the Foreman model menu under the message box changes it. If the options change somewhere else while you edit them (a gate card’s chips, the level chip), Save stops and offers to reload them.</p>
      </HowThisWorks>
    </Drawer>
  );
}
