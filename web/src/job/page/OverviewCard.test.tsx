// The job page's overview card (design 3.1): the ticket as written, what we're building, what to
// check. Folded the first time, then as you left it. Invented jobs and tickets only.
import { act, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import type { JobDetail, JobPageFacts } from '../../api/types';
import { createStore, WorkshopContext } from '../../state/store';
import { job } from '../../state/test-fixtures';
import { BUILDING_NOT_WRITTEN, OverviewCard } from './OverviewCard';
import { CHECK_NOT_WRITTEN, WhatToCheck } from './WhatToCheck';

const TICKET = {
  key: 'ORBIT-900',
  title: 'Let office staff pause a recurring service instead of cancelling it',
  url: 'https://orbit.example/tickets/ORBIT-900',
  filedBy: 'Dana Whitfield',
  filedAt: '2026-11-03T18:00:00Z',
  description: 'When a customer goes away for a few weeks we cancel their recurring service.\nThat loses their route slot.\n\nCan we pause it instead?',
};
const FULL: JobPageFacts = {
  ticket: TICKET,
  building: {
    from: 'spec', version: '0.3',
    outcome: ['Office staff can pause a recurring service for 1 to 12 weeks.', 'The service starts again by itself on the chosen date.'],
    risks: ['A visit already on today’s route can’t be paused, only skipped.'],
  },
  check: {
    version: null,
    worksWhen: ['Office staff see Pause on a recurring service.', 'Picking 3 weeks takes the next 3 weekly visits off the route.'],
    mustNot: ['Charge for a paused visit.', 'Let a technician pause a service.'],
  },
};

const detailOf = (slug: string, page: JobPageFacts | undefined): JobDetail => ({ slug, page } as JobDetail);

function show(page: JobPageFacts | undefined, { slug = 'pause-a-recurring-service', ticket = 'ORBIT-900' as string | null, wrap = (n: ReactNode) => n } = {}) {
  const j = job(slug, 'needs-you', ticket ? { ticket: { key: ticket } } : {});
  return render(<>{wrap(<OverviewCard job={j} detail={detailOf(slug, page)} />)}</>);
}

const card = () => screen.getByText('Overview').closest('details') as HTMLDetailsElement;
function open() {
  const d = card();
  act(() => { d.open = true; d.dispatchEvent(new Event('toggle')); });
}
const column = (name: string) => screen.getByRole('region', { name });

beforeEach(() => { localStorage.clear(); });

describe('OverviewCard', () => {
  it('folded the first time, with the ticket number in its line; open it and it stays open for the next job', () => {
    const first = show(FULL);
    expect(card().open).toBe(false);
    expect(card().querySelector('summary')).toHaveTextContent('Overview· ORBIT-900 as written, what we’re building, what to check');
    open();
    expect(card().open).toBe(true);
    first.unmount();

    show({ ...FULL, ticket: null }, { slug: 'another-job', ticket: null });
    expect(card().open).toBe(true);
    expect(card().querySelector('summary')).toHaveTextContent('Overview· What we’re building, what to check');
  });

  it('the ticket as written: title, who filed it and when, the description, a link', () => {
    show(FULL);
    open();
    const t = column('The ticket');
    expect(within(t).getByText(TICKET.title)).toBeInTheDocument();
    expect(within(t).getByText('ORBIT-900 · filed by Dana Whitfield on Nov 3')).toBeInTheDocument();
    const paras = within(t).getAllByText(/./, { selector: 'p' }).map((p) => p.textContent);
    expect(paras).toEqual([
      'When a customer goes away for a few weeks we cancel their recurring service.\nThat loses their route slot.',
      'Can we pause it instead?',
    ]);
    const link = within(t).getByRole('link', { name: 'Open ORBIT-900 in Orbit' });
    expect(link).toHaveAttribute('href', TICKET.url);
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('what we’re building comes from the spec summary, or the first brief’s before there is a spec', () => {
    const first = show(FULL);
    open();
    let b = column('What we’re building');
    expect(within(b).getByText('From spec v0.3')).toBeInTheDocument();
    for (const line of FULL.building!.outcome!) expect(within(b).getByText(line)).toBeInTheDocument();
    expect(within(b).getByText('Risks')).toBeInTheDocument();
    expect(within(b).getByRole('list')).toHaveTextContent(FULL.building!.risks![0]);
    first.unmount();

    const v3 = show({ ...FULL, building: { ...FULL.building, version: '3' } });
    b = column('What we’re building');
    expect(within(b).getByText('From spec v3')).toBeInTheDocument();
    v3.unmount();

    const noVersion = show({ ...FULL, building: { ...FULL.building, version: null } });
    b = column('What we’re building');
    expect(within(b).getByText('From the spec')).toBeInTheDocument();
    noVersion.unmount();

    show({ ...FULL, building: { from: 'brief', version: null, outcome: ['Pause a service for a few weeks.'], risks: [] } });
    b = column('What we’re building');
    expect(within(b).getByText('From the first brief')).toBeInTheDocument();
    expect(within(b).getByText('Pause a service for a few weeks.')).toBeInTheDocument();
    expect(within(b).queryByText('Risks')).toBeNull();
  });

  it('what to check lists It works when and It must not', () => {
    show(FULL);
    open();
    const c = column('What to check');
    expect(within(c).getByText('It works when')).toBeInTheDocument();
    expect(within(c).getByText('It must not')).toBeInTheDocument();
    const [works, mustNot] = within(c).getAllByRole('list');
    expect(within(works).getAllByRole('listitem').map((li) => li.textContent)).toEqual(FULL.check!.worksWhen);
    expect(within(mustNot).getAllByRole('listitem').map((li) => li.textContent)).toEqual(FULL.check!.mustNot);
  });

  it('an old job: no filer, no check list, no summary, and the card is still whole', () => {
    // A ticket with a date and no filer, and no summary or acceptance.md yet.
    const dated = show({ ticket: { ...TICKET, filedBy: null }, building: null, check: null });
    open();
    expect(within(column('The ticket')).getByText('ORBIT-900 · filed on Nov 3')).toBeInTheDocument();
    expect(within(column('What we’re building')).getByText('Not written yet. The Foreman writes this with its first brief.')).toBeInTheDocument();
    expect(within(column('What to check')).getByText('Not written yet. The Foreman writes this list with the plan.')).toBeInTheDocument();
    dated.unmount();

    // Neither filer nor date: the number alone.
    const bare = show({ ticket: { ...TICKET, filedBy: null, filedAt: null } });
    expect(within(column('The ticket')).getByText('ORBIT-900')).toBeInTheDocument();
    bare.unmount();

    // An older Starbase: no page facts at all. The ticket number comes from the job; every column still says something.
    const old = show(undefined);
    expect(card().querySelector('summary')).toHaveTextContent('ORBIT-900 as written, what we’re building, what to check');
    expect(within(column('The ticket')).getByText('ORBIT-900')).toBeInTheDocument();
    expect(within(column('What we’re building')).getByText('Not written yet. The Foreman writes this with its first brief.')).toBeInTheDocument();
    expect(within(column('What to check')).getByText('Not written yet. The Foreman writes this list with the plan.')).toBeInTheDocument();
    old.unmount();

    // No ticket at all, and the answer not loaded yet.
    render(<OverviewCard job={job('no-ticket', 'idle')} detail={null} />);
    expect(within(column('The ticket')).getByText('This job did not start from an Orbit ticket.')).toBeInTheDocument();
    expect(within(column('What we’re building')).getByText('Not written yet. The Foreman writes this with its first brief.')).toBeInTheDocument();
    expect(within(column('What to check')).getByText('Not written yet. The Foreman writes this list with the plan.')).toBeInTheDocument();
  });

  it('a description with a tag in it shows as text', () => {
    show({ ...FULL, ticket: { ...TICKET, description: 'Pause <img src="x" alt="sneaky"> and <b>keep</b> the slot.' } });
    open();
    const t = column('The ticket');
    expect(within(t).getByText('Pause <img src="x" alt="sneaky"> and <b>keep</b> the slot.')).toBeInTheDocument();
    expect(t.querySelector('img')).toBeNull();
    expect(within(t).queryByText('keep')).toBeNull();
  });

  it('the ticket is a link only when its address is http or https; otherwise its number shows as text', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,hi', '/tickets/ORBIT-900', 'orbit.example/tickets/ORBIT-900', ' JavaScript:alert(1)']) {
      const view = show({ ...FULL, ticket: { ...TICKET, url } });
      open();
      const t = column('The ticket');
      expect(within(t).queryByRole('link')).toBeNull();
      expect(t.querySelector('a')).toBeNull();
      expect(within(t).getByText('ORBIT-900 · filed by Dana Whitfield on Nov 3')).toBeInTheDocument();
      view.unmount();
    }
    for (const url of ['http://orbit.example/t/1', 'https://orbit.example/t/1', 'HTTPS://orbit.example/t/1']) {
      const view = show({ ...FULL, ticket: { ...TICKET, url } });
      expect(within(column('The ticket')).getByRole('link', { name: 'Open ORBIT-900 in Orbit' })).toHaveAttribute('href', url);
      view.unmount();
    }
  });

  it('a description written with \\r\\n line ends splits into paragraphs as one with \\n does', () => {
    show({ ...FULL, ticket: { ...TICKET, description: 'When a customer goes away we cancel.\r\nThat loses their slot.\r\n\r\nCan we pause it instead?\r\n \r\nThanks.\r\n' } });
    open();
    const paras = within(column('The ticket')).getAllByText(/./, { selector: 'p' }).map((p) => p.textContent);
    expect(paras).toEqual(['When a customer goes away we cancel.\r\nThat loses their slot.', 'Can we pause it instead?', 'Thanks.']);
  });

  it('a list that is not a list, or has holes, shows as nothing, never a crash', () => {
    const bad = { from: 'spec', version: '1', outcome: 'Pause a service.', risks: { 0: 'not a list' } } as unknown as JobPageFacts['building'];
    const view = show({ ...FULL, ticket: { ...TICKET, description: 42 as unknown as string }, building: bad });
    open();
    expect(within(column('What we’re building')).getByText(BUILDING_NOT_WRITTEN)).toBeInTheDocument();
    expect(within(column('The ticket')).getByText(TICKET.title)).toBeInTheDocument();
    view.unmount();
    const holes = { from: 'spec', version: '1', outcome: [null, 'Pause a service.', 7], risks: [undefined, 'A visit on today’s route.'] } as unknown as JobPageFacts['building'];
    show({ ...FULL, building: holes });
    const b = column('What we’re building');
    expect([...b.querySelectorAll('.sb-ov-desc')].map((p) => p.textContent)).toEqual(['Pause a service.']);
    expect(within(b).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['A visit on today’s route.']);
  });

  it('What to check: a list that is not a list, or has holes, shows as nothing, never a crash', () => {
    const view = render(<WhatToCheck check={{ version: null, worksWhen: 'Pause shows.', mustNot: { a: 1 } } as unknown as JobPageFacts['check']} />);
    expect(screen.getByText(CHECK_NOT_WRITTEN)).toBeInTheDocument();
    view.unmount();
    render(<WhatToCheck check={{ version: null, worksWhen: [null, 'Pause shows.'], mustNot: 'Charge.' } as unknown as JobPageFacts['check']} />);
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Pause shows.']);
    expect(screen.queryByText('It must not')).toBeNull();
  });

  it('the website shows the same card', () => {
    const api = { get: vi.fn(), post: vi.fn(), hosted: () => true } as unknown as ApiClient;
    show(FULL, { wrap: (n) => <WorkshopContext.Provider value={{ store: createStore(), api }}>{n}</WorkshopContext.Provider> });
    expect(card().open).toBe(false);
    open();
    expect(within(column('The ticket')).getByText('ORBIT-900 · filed by Dana Whitfield on Nov 3')).toBeInTheDocument();
    expect(within(column('The ticket')).getByRole('link', { name: 'Open ORBIT-900 in Orbit' })).toHaveAttribute('href', TICKET.url);
    expect(within(column('What we’re building')).getByText('From spec v0.3')).toBeInTheDocument();
    expect(within(column('What to check')).getByText('Charge for a paused visit.')).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });
});
