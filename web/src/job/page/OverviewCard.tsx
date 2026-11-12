// The job page's overview card (design 3.1): one fold at the top holding the ticket as written,
// what we're building and what to check, three columns side by side (one under another when
// narrow). Folded the first time; after that it stays as you left it, for every job. Every fact
// comes from the job answer's `page` (JobPageFacts) and may be missing on an older Starbase or the
// website: each column then says so in a sentence, and the card is still whole.
import { useId, type ReactNode } from 'react';
import type { Job, JobDetail, JobPageFacts } from '../../api/types';
import { Icon } from '../../components/Icon';
import { Fold } from '../../components/page/Page';
import { ticketOf } from '../NextStep';
import { WhatToCheck } from './WhatToCheck';
import './page.css';

export const NO_TICKET = 'This job did not start from an Orbit ticket.';
export const BUILDING_NOT_WRITTEN = 'Not written yet. The Foreman writes this with its first brief.';

export type Ticket = NonNullable<JobPageFacts['ticket']>;
type Building = JobPageFacts['building'];

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

/** The ticket from the page facts, else the job's own ticket number (an older Starbase): null when none. */
export function ticketFor(job: Job, page: JobPageFacts | undefined): Ticket | null {
  const t = page?.ticket;
  if (t && text(t.key)) return t;
  const key = ticketOf(job);
  return key && text(key) ? { key } : null;
}

/** "Nov 3", or null when the time can't be read. */
function day(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** "ORBIT-900 · filed by Dana Whitfield on Nov 3", with what is not known left out. */
function filedLine(t: Ticket): string {
  const by = text(t.filedBy);
  const on = day(t.filedAt);
  if (!by && !on) return t.key ?? '';
  return `${t.key} · filed${by ? ` by ${by}` : ''}${on ? ` on ${on}` : ''}`;
}

/** The description as plain paragraphs (a blank line between them); always text, never HTML. */
const paragraphs = (description: string | null | undefined) =>
  (description ?? '').split(/\n[ \t]*\n/).map((p) => p.replace(/^\n+|\n+$/g, '')).filter((p) => p.trim());

/** One of the three parts under its heading: h3 in the card, h2 on the phone's overview screen (under its h1). */
export function Column({ title, level = 3, children }: { title: string; level?: 2 | 3; children: ReactNode }) {
  const id = useId();
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <section className="sb-ov-col" aria-labelledby={id}>
      <Heading className="eyebrow" id={id}>{title}</Heading>
      {children}
    </section>
  );
}

export function TheTicket({ ticket }: { ticket: Ticket | null }) {
  if (!ticket) return <p className="sb-ov-empty">{NO_TICKET}</p>;
  const title = text(ticket.title);
  const url = text(ticket.url);
  return (
    <>
      {title && <b className="sb-ov-title">{title}</b>}
      <span className="sb-ov-meta">{filedLine(ticket)}</span>
      {paragraphs(ticket.description).map((p, i) => <p key={i} className="sb-ov-desc">{p}</p>)}
      {url && (
        <a className="sb-ov-link" href={url} target="_blank" rel="noopener noreferrer" title="Opens the ticket in Orbit in a new tab.">
          Open {ticket.key} in Orbit<Icon name="external" size={13} />
        </a>
      )}
    </>
  );
}

export function WhatWereBuilding({ building }: { building: Building }) {
  const outcome = building?.outcome ?? [];
  const risks = building?.risks ?? [];
  if (!building || (!outcome.length && !risks.length)) return <p className="sb-ov-empty">{BUILDING_NOT_WRITTEN}</p>;
  const version = text(building.version);
  const from = building.from === 'brief' ? 'From the first brief' : version ? `From spec v${version}` : 'From the spec';
  return (
    <>
      <span className="sb-ov-meta">{from}</span>
      {outcome.map((line, i) => <p key={i} className="sb-ov-desc">{line}</p>)}
      {risks.length > 0 && (
        <>
          <b className="sb-ov-label">Risks</b>
          <ul className="sb-ov-list">
            {risks.map((line, i) => (
              <li key={i}><Icon name="warn" size={14} className="sb-ov-mark is-warn" /><span>{line}</span></li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

/** The overview's note: what it holds, with the ticket's number when there is one. */
export const overviewNote = (ticket: Ticket | null) => (ticket ? `${ticket.key} as written, what we’re building, what to check` : 'What we’re building, what to check');

export function OverviewCard({ job, detail }: { job: Job; detail: JobDetail | null }) {
  const page = detail?.page;
  const ticket = ticketFor(job, page);
  const note = overviewNote(ticket);
  return (
    <Fold icon="clipboard" name="Overview" note={note} id="job-overview">
      <div className="sb-overview">
        <div className="sb-ov-cols">
          <Column title="The ticket"><TheTicket ticket={ticket} /></Column>
          <Column title="What we’re building"><WhatWereBuilding building={page?.building} /></Column>
          <Column title="What to check"><WhatToCheck check={page?.check} /></Column>
        </div>
      </div>
    </Fold>
  );
}
