// A Foreman reply, his own message or a brief in the reader (job page rebuild, Task 12; design brief
// "The reader"): typeset for reading (Prose.tsx). The message's own headline is the title row's title,
// so it is not said again; bold lines alone are headings; the part that asks him carries the left rule.
// A brief whose detail was written apart (briefs/NNN-…-detail.md, folded out of the conversation) ends
// with a way to read the detail.

import type { ReaderTarget } from '../types';
import { useJob } from '../useJob';
import { prepareMessage, Prose } from './Prose';
import { NotLoaded, ReaderBody, useBody } from './ReaderBody';
import { placeKey, titleOf } from './TitleRow';

export interface MessageViewProps {
  target: ReaderTarget;
  onOpen(t: ReaderTarget, from?: HTMLElement | null): void;
}

export function MessageView({ target, onOpen }: MessageViewProps) {
  const { body, error } = useBody(target.id);
  const title = useJob((s) => (s.payload?.thread.some((l) => l.id === target.id) ? titleOf(target, s.payload).title : null));
  const detail = typeof body?.meta.detail === 'string' ? body.meta.detail : null;
  return (
    <ReaderBody view={target.kind} place={placeKey(target)} ready={body !== null}>
      {body ? (
        <>
          <Prose prepared={prepareMessage(body, title)} onOpen={onOpen} />
          {detail && (
            <p className="jp2-rv-after">
              <button type="button" className="link-button" onClick={(e) => onOpen({ kind: 'brief', id: detail }, e.currentTarget)}>Read the detail of this brief</button>
            </p>
          )}
        </>
      ) : <NotLoaded error={error} />}
    </ReaderBody>
  );
}
