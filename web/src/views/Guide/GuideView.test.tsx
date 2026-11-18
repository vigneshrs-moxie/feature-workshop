// The Guide page (GuideView.tsx): the contents on the left with the page open marked, the page's
// words with its pictures, Previous / Next, an unknown page, a section from the address, and Find.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import pages from 'virtual:starbase-guide';
import { JOBS_GUIDE } from '../../home/JobsPage';
import { DESK_GUIDE } from '../../home/DeskPage';
import { JOB_PAGE_GUIDE } from '../../jobpage/left/Header';
import { REVIEW_GUIDE } from '../../views/Review/words';
import { Guide } from '../../components/page/Page';
import { findInGuide, GuideView } from './GuideView';

afterEach(cleanup);

const list = () => within(screen.getByRole('navigation', { name: 'Guide pages' }));

describe('the Guide page', () => {
  it('opens on the contents: every page listed in order, the contents marked', () => {
    render(<GuideView />);
    const rows = list().getAllByRole('link');
    expect(rows.map((a) => a.textContent)).toEqual(['Contents', ...pages.slice(1).map((p) => `${p.n}. ${p.title}`)]);
    expect(rows).toHaveLength(13);
    expect(rows[0]).toHaveAttribute('aria-current', 'page');
    expect(rows[0]).toHaveAttribute('href', '#/guide');
    expect(rows[3]).toHaveAttribute('href', '#/guide/03-jobs');
    expect(screen.getByRole('heading', { level: 2, name: 'Starbase user guide' })).toBeInTheDocument();
    // The contents' own table links to the pages at the app's addresses.
    expect(screen.getByRole('main', { name: 'Guide' }).querySelector('.ug-text a[href="#/guide/01-start-here"]')).not.toBeNull();
    // The contents has no page before it.
    const foot = within(screen.getByRole('navigation', { name: 'Previous and next page' }));
    expect(foot.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['#/guide/01-start-here']);
  });

  it('shows a page with its pictures, marked in the list, with the pages before and after it', () => {
    render(<GuideView page="04-a-job" />);
    expect(screen.getByRole('heading', { level: 2, name: '4. A job' })).toBeInTheDocument();
    expect(list().getByRole('link', { name: '4. A job' })).toHaveAttribute('aria-current', 'page');
    expect(list().getAllByRole('link').filter((a) => a.getAttribute('aria-current'))).toHaveLength(1);
    const pic = screen.getByRole('img', { name: 'The new job page while a decision waits' });
    expect(pic.getAttribute('src')).toMatch(/\/guide\/img\/job-deciding\.png$/);
    const foot = within(screen.getByRole('navigation', { name: 'Previous and next page' }));
    expect(foot.getByRole('link', { name: /3\. The Jobs page/ })).toHaveAttribute('href', '#/guide/03-jobs');
    expect(foot.getByRole('link', { name: /5\. Answering a decision fast/ })).toHaveAttribute('href', '#/guide/05-deciding');
  });

  it('the last page has no next page', () => {
    render(<GuideView page="12-glossary" />);
    const foot = within(screen.getByRole('navigation', { name: 'Previous and next page' }));
    expect(foot.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['#/guide/11-troubleshooting']);
  });

  it('an unknown page shows the contents, with a plain line saying so', () => {
    render(<GuideView page="99-nothing" />);
    expect(screen.getByRole('status')).toHaveTextContent('There is no guide page called “99-nothing”. Here are the contents.');
    expect(screen.getByRole('heading', { level: 2, name: 'Starbase user guide' })).toBeInTheDocument();
    expect(list().getByRole('link', { name: 'Contents' })).toHaveAttribute('aria-current', 'page');
  });

  it('a section in the address takes the focus, and each heading links to its own address', () => {
    render(<GuideView page="05-deciding" section="the-message-box" />);
    const heading = screen.getByRole('heading', { name: /^The message box/ });
    expect(heading).toHaveFocus();
    expect(within(heading).getByRole('link', { name: 'This section’s address' })).toHaveAttribute('href', '#/guide/05-deciding/the-message-box');
  });

  it('Find lists the pages with the words, how often, and opens each where they first appear', () => {
    render(<GuideView page="03-jobs" />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find in the guide' }), { target: { value: 'Send back' } });
    const hits = within(screen.getByRole('list', { name: 'Pages with these words' })).getAllByRole('link');
    expect(hits.length).toBeGreaterThan(1);
    const deciding = hits.find((a) => a.textContent?.startsWith('5. Answering a decision fast'))!;
    // Its first "send back" is before its first heading: the page's top.
    expect(deciding.getAttribute('href')).toBe('#/guide/05-deciding');
    const sections = within(screen.getByRole('list', { name: 'Pages with these words' })).getAllByRole('link').filter((a) => /^#\/guide\/[\w-]+\/[\w-]+$/.test(a.getAttribute('href') ?? ''));
    expect(sections.length).toBeGreaterThan(0);
    expect(deciding).toHaveTextContent(/send back/i);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find in the guide' }), { target: { value: 'zzqqxx' } });
    expect(screen.getByText('No page has “zzqqxx”.')).toBeInTheDocument();
    // Escape clears it: the contents come back.
    fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Find in the guide' }), { key: 'Escape' });
    expect(list().getAllByRole('link')).toHaveLength(13);
  });

  it('finds nothing for fewer than two letters', () => {
    expect(findInGuide(pages, 'a')).toEqual([]);
    expect(findInGuide(pages, 'Foreman').length).toBeGreaterThan(3);
  });
});

describe('How it works points at the guide', () => {
  it('each page’s cards name a guide page (and section) that is there', () => {
    render(<GuideView />);
    // Telemetry's, the Inbox's and the website's pages' cards are made inside their files: their words here.
    const reads = [...[JOBS_GUIDE, DESK_GUIDE, JOB_PAGE_GUIDE, REVIEW_GUIDE].map((s) => s.read!), '08-other-pages#telemetry', '08-other-pages#inbox', '09-the-website'];
    for (const read of reads) {
      const [page, section] = read.split('#');
      const found = pages.find((p) => p.id === page);
      expect(found, read).toBeDefined();
      if (section) expect(found!.html, read).toContain(`id="h-${section}"`);
    }
    expect(JOBS_GUIDE.read).toBe('03-jobs');
    expect(JOB_PAGE_GUIDE.read).toBe('04-a-job');
  });
});

describe('How it works offers Read the guide', () => {
  it('the cards link to their guide page, and to the section when they name one; without one, no link', () => {
    const closed = vi.fn();
    render(<Guide spec={JOBS_GUIDE} onClose={closed} />);
    const read = screen.getByRole('link', { name: 'Read the guide' });
    expect(read).toHaveAttribute('href', '#/guide/03-jobs');
    fireEvent.click(read);
    expect(closed).toHaveBeenCalledTimes(1);
    cleanup();
    render(<Guide spec={DESK_GUIDE} onClose={() => {}} />);
    expect(screen.getByRole('link', { name: 'Read the guide' })).toHaveAttribute('href', '#/guide/05-deciding/the-desk-every-decision-one-at-a-time');
    cleanup();
    render(<Guide spec={{ ...JOBS_GUIDE, read: undefined }} onClose={() => {}} />);
    expect(screen.queryByRole('link', { name: 'Read the guide' })).toBeNull();
  });
});
