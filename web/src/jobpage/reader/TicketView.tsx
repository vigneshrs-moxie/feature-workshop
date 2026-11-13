// Ticket and goal in the reader (job page rebuild, Task 12; design brief "The job" rows): a plain
// document of three parts, the ticket as written, what we are building (with its risks) and what to
// check, from the one body the server makes of the job's page facts (item id `ticket`,
// lib/job-payload-cache.js ticketMarkdown).

import type { ReaderTarget } from '../types';
import { DocLayout } from './DocView';
import { prepareDoc } from './Prose';
import { NotLoaded, ReaderBody, useBody } from './ReaderBody';

export function TicketView({ onOpen }: { onOpen(t: ReaderTarget, from?: HTMLElement | null): void }) {
  const { body, error } = useBody('ticket');
  return (
    <ReaderBody view="ticket" place="ticket:ticket" ready={body !== null}>
      {body ? <DocLayout prepared={prepareDoc(body)} onOpen={onOpen} /> : <NotLoaded error={error} />}
    </ReaderBody>
  );
}
