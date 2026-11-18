// The reader, the right pane (job page rebuild, Task 12; plan "Decisions already made" 2, design brief
// "The reader"): it shows exactly one thing, under the same thin title row (TitleRow.tsx). What it
// shows is targets.ts readerOf: his pick, else the opened step's main output, else the payload's `open`.
//
// Views: a message or a brief (MessageView), a document (DocView), Ticket and goal (TicketView),
// Decisions (DecisionsView), What Auto decided (AutoView), a step with nothing written yet (NotYet), the conversation
// (ConversationView: one line per item, folded), Changes (ChangesView: commits, files, the diff),
// Findings, Checks and recording with Your hand test, and Details (Task 14). Ship (its PR lines) and a
// PR (its line) are Task 20's (left/PrLines.tsx), and a PR's comments Task 21's (PrView). The Spec step's
// Screens and the Review step's Walkthrough are the old page's framed parts (FramedViews.tsx). A waiting
// permission is never a reader target (its card is Your move; targets.ts readerOf shows the step's work).
//
// Each view is drawn fresh for each thing read (keyed by it) inside ReaderBody, which keeps every
// thing's own scroll place. A body held in the store paints in the same frame as the pick; one not held
// shows the title row at once and its words when they land (speed rules 2 and 3).

import { memo } from 'react';
import { readerBesideConvo, readerOf, sameTarget } from '../targets';
import type { ReaderTarget } from '../types';
import { useJob } from '../useJob';
import { ChangesView } from './ChangesView';
import { ChecksView } from './ChecksView';
import { ConversationView } from './ConversationView';
import { AutoView } from './AutoView';
import { DecisionsView } from './DecisionsView';
import { DetailsView } from './DetailsView';
import { DocView } from './DocView';
import { FindingsView } from './FindingsView';
import { ScreensView, WalkthroughView } from './FramedViews';
import { MessageView } from './MessageView';
import { PictureView } from '../notes/Pins';
import { PrLines } from '../left/PrLines';
import { PrView } from './PrView';
import { ReaderBody } from './ReaderBody';
import { TicketView } from './TicketView';
import { placeKey, TitleRow } from './TitleRow';

export interface ReaderProps {
  /** The job's title from the Jobs row, for the title row before the payload names a target. */
  fallback: string;
  searchRef: React.RefObject<HTMLInputElement | null>;
  /** The page's own pick (the address follows; under 1100 px the reader stays over the left pane). */
  onOpen(t: ReaderTarget, from?: HTMLElement | null): void;
  /** The conversation has its own column (a laptop): the reader never shows it (targets.ts readerBesideConvo). */
  convoBeside?: boolean;
}

export const Reader = memo(function Reader({ fallback, searchRef, onOpen, convoBeside = false }: ReaderProps) {
  const target = useJob(convoBeside ? readerBesideConvo : readerOf, sameTarget);
  return (
    <>
      <TitleRow target={target} fallback={fallback} onOpen={onOpen} />
      {target ? <View key={placeKey(target)} target={target} searchRef={searchRef} onOpen={onOpen} /> : <div className="jp2-rv-body" />}
    </>
  );
});

function View({ target, searchRef, onOpen }: { target: ReaderTarget } & Pick<ReaderProps, 'searchRef' | 'onOpen'>) {
  switch (target.kind) {
    case 'message':
    case 'brief':
      return <MessageView target={target} onOpen={onOpen} />;
    case 'doc':
      return <DocView id={target.id} onOpen={onOpen} />;
    case 'ticket':
      return <TicketView onOpen={onOpen} />;
    case 'decisions':
      return <DecisionsView />;
    // What Auto decided (18 Nov): opened from the button beside the header's Auto switch.
    case 'auto':
      return <AutoView />;
    case 'conversation':
      return <ConversationView searchRef={searchRef} onOpen={onOpen} />;
    case 'changes':
      return <ChangesView />;
    case 'findings':
      return <FindingsView onOpen={onOpen} />;
    case 'checks':
      return <ChecksView id={target.id} onOpen={onOpen} />;
    case 'details':
      return <DetailsView />;
    case 'picture':
      return <PictureView id={target.id} />;
    case 'not-yet':
      return <ReaderBody view="not-yet" place={placeKey(target)}><NotYet id={target.id} /></ReaderBody>;
    // Task 20 (R2): Ship is its PR lines; a PR's own view is its line (Task 21 adds its comments).
    case 'ship':
      return <ReaderBody view="ship" place={placeKey(target)}><PrLines note /></ReaderBody>;
    // Task 21 (R3): a PR's view is its line, its verdict, its failed checks and its comments.
    case 'pr':
      return <PrView n={prOf(target.id)} onOpen={onOpen} />;
    case 'screens':
      return <ScreensView place={placeKey(target)} />;
    case 'walkthrough':
      return <WalkthroughView place={placeKey(target)} />;
    // readerOf never names a permission (its card is in Your move); an old address that does shows the conversation.
    case 'permission':
      return <ConversationView searchRef={searchRef} onOpen={onOpen} />;
  }
}

const prOf = (id: string): 1 | 2 | 3 => (id === '2' ? 2 : id === '3' ? 3 : 1);

/** A step that has written nothing (yet): what it is doing, said plainly. */
function NotYet({ id }: { id: string }) {
  const state = useJob((s) => s.payload?.steps.find((x) => x.id === id)?.state ?? null);
  const words = state === 'skipped' ? 'This job skips this step.'
    : state === 'current' ? 'Nothing written yet. The Foreman is on this step.'
      : state === 'done' ? 'This step wrote no document.'
        : 'Nothing yet. This step has not started.';
  return <p className="jp2-notyet">{words}</p>;
}
