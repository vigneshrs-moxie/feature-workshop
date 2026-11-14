// The phone's own three screens (plan Task 15; design brief "Phone"). At 760 px and under the new job
// page is three simple screens by address, not the laptop squeezed:
//   job     #/job/<slug>: back to Jobs, the title, the state word (the header, here inside the
//           screen's scroll area, so it scrolls away), Your move in full, the seven steps one line
//           each with a ›, the job's four rows, and the message box fixed at the bottom, below the
//           scroll area, so it never lies over the last row. It is the left pane itself (JobPage2),
//           with the same parts as the laptop's, so the draft, the picks and the box keep their
//           elements when the width changes.
//   step    #/job/<slug>/stage/<stop>: PhoneStep, what that step made, one row each.
//   reader  #/job/<slug>/read/<kind>/<id>, /conversation, /overview: the reader full width, one
//           thing, with PhoneReader's back row.
// The PR line on the job screen (it ends in `Comments · 3 new`, which opens the PR view) comes with
// Tasks 20 and 21; JobPage2 marks its place, under the steps.
//
// Moving to another screen is a new history entry, marked as the phone's, so the back rows follow
// history: on a marked entry Back is the browser's Back (the step screen, then the job screen, with
// the focus on the row that opened them); on a screen opened by a link or a reload, with nothing of
// the page behind it, Back goes to the job screen in place. A pick inside the screen it is on (the
// reader's previous and next, a link in a document, [ and ] on the step screen) changes the address in
// place, so Back still goes to where the screen was opened from.

import { useMemo, useRef } from 'react';
import { jobHref, pushHash, readHref, replaceHash, stageHref, type JobView } from '../../app/router';
import { Icon } from '../../components/Icon';
import type { ReaderTarget, StopId } from '../types';

export type PhoneScreen = 'job' | 'step' | 'reader';

/** The phone's screen for the address's parts: a step its screen, a reader address or a view the reader, else the job. */
export function phoneScreenOf(step: StopId | undefined, view: JobView | undefined, read: ReaderTarget | undefined): PhoneScreen {
  if (step) return 'step';
  if (read || view) return 'reader';
  return 'job';
}

/** The mark on a history entry the phone's screens wrote: Back from it is the browser's Back. */
const MARK = 'sbPhoneScreen';
const marked = (state: unknown) => typeof state === 'object' && state !== null && (state as Record<string, unknown>)[MARK] === true;

export interface PhoneMoves {
  /** To a step's screen (in place when already on a step's screen). */
  toStep(id: StopId): void;
  /** To the reader screen (in place when already on it). */
  toReader(t: ReaderTarget): void;
  /** A back row: the browser's Back on an entry the phone wrote, else the job screen in place. */
  back(): void;
}

/** The moves between the phone's screens for the job, on the screen it is on now. */
export function usePhoneMoves(slug: string, screen: PhoneScreen | null): PhoneMoves {
  const on = useRef(screen);
  /** A move has pushed an entry since the screen last changed: a second tap before the page has
   *  drawn the new screen (a fast double tap) moves in place, never a second entry. */
  const pushed = useRef(false);
  if (on.current !== screen) pushed.current = false;
  on.current = screen;
  return useMemo(() => {
    const go = (href: string, here: boolean) => {
      if (here || pushed.current) { replaceHash(href); return; }
      pushed.current = true;
      pushHash(href, { [MARK]: true });
    };
    return {
      toStep: (id) => go(stageHref(slug, id), on.current === 'step'),
      toReader: (t) => go(readHref(slug, t), on.current === 'reader'),
      back: () => {
        if (marked(window.history.state)) window.history.back();
        else replaceHash(jobHref(slug));
      },
    };
  }, [slug]);
}

/** The › at the end of a line that opens another screen on the phone (hidden on a laptop). */
export function PhoneChevron() {
  return <span className="jp2-chev" aria-hidden="true"><Icon name="chevron-right" size={16} /></span>;
}
