import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { classicHref, hrefFor, jobHref, jobViewHref, openFromHash, pageName, parseHash, peekFromHash, readHref, replaceHash, screensHref, stageHref, useRoute, withPeek } from './router';

describe('hash router', () => {
  it.each([
    ['', { name: 'home' }],
    ['#', { name: 'home' }],
    ['#/', { name: 'home' }],
    ['#/jobs', { name: 'home' }],
    ['#/map', { name: 'map' }],
    ['#/map?play=full', { name: 'map' }],
    ['#/job/alpha', { name: 'job', slug: 'alpha' }],
    ['#/job/alpha/', { name: 'job', slug: 'alpha' }],
    ['#/job/with%20space', { name: 'job', slug: 'with space' }],
    ['#/job/', { name: 'not-found', hash: '#/job/' }],
    ['#/job/a/b', { name: 'not-found', hash: '#/job/a/b' }],
    ['#/job/alpha/id/FR-001', { name: 'job', slug: 'alpha' }],
    ['#/job/alpha/screens', { name: 'screens', slug: 'alpha' }],
    ['#/job/alpha/screens/', { name: 'screens', slug: 'alpha' }],
    ['#/job/alpha/screens?theme=glass', { name: 'screens', slug: 'alpha' }],
    ['#/job/alpha/screens/x', { name: 'not-found', hash: '#/job/alpha/screens/x' }],
    ['#/job/alpha/pictures', { name: 'not-found', hash: '#/job/alpha/pictures' }],
    ['#/job/%E0%A4%A', { name: 'not-found', hash: '#/job/%E0%A4%A' }],
    ['#/costs', { name: 'not-found', hash: '#/costs' }],
    ['#/settings', { name: 'settings' }],
    ['#/settings/', { name: 'settings' }],
    ['#/settings/x', { name: 'not-found', hash: '#/settings/x' }],
    ['#/settings/workflow', { name: 'settings', section: 'workflow' }],
    ['#/settings/notifications/', { name: 'settings', section: 'notifications' }],
    ['#/settings/rules?theme=glass', { name: 'settings', section: 'rules' }],
    ['#/settings/Workflow', { name: 'not-found', hash: '#/settings/Workflow' }],
    ['#/crew', { name: 'crew' }],
    ['#/crew/', { name: 'crew' }],
    ['#/crew?theme=pixel-crew', { name: 'crew' }],
    ['#/crew/x', { name: 'not-found', hash: '#/crew/x' }],
    ['#/achievements', { name: 'achievements' }],
    ['#/achievements/', { name: 'achievements' }],
    ['#/achievements?theme=gold', { name: 'achievements' }],
    ['#/achievements/x', { name: 'not-found', hash: '#/achievements/x' }],
    ['#/nowhere?theme=crt', { name: 'not-found', hash: '#/nowhere' }],
    // An in-page anchor is not a route.
    ['#h-summary', { name: 'home' }],
    // A query after the hash (the theme preview) changes nothing about the route.
    ['#/?theme=blueprint', { name: 'home' }],
    ['#/settings?theme=blueprint', { name: 'settings' }],
    ['#/job/alpha?theme=blueprint', { name: 'job', slug: 'alpha' }],
    ['#/job/alpha/id/FR-001?theme=blueprint', { name: 'job', slug: 'alpha' }],
  ])('%s', (hash, route) => {
    expect(parseHash(hash)).toEqual(route);
  });

  it('builds links that parse back', () => {
    expect(jobHref('a b/c')).toBe('#/job/a%20b%2Fc');
    expect(parseHash(jobHref('a b/c'))).toEqual({ name: 'job', slug: 'a b/c' });
    expect(hrefFor({ name: 'home' })).toBe('#/');
    expect(hrefFor({ name: 'settings' })).toBe('#/settings');
    expect(hrefFor({ name: 'settings', section: 'look' })).toBe('#/settings/look');
    expect(parseHash(hrefFor({ name: 'settings', section: 'play' }))).toEqual({ name: 'settings', section: 'play' });
    expect(screensHref('a b')).toBe('#/job/a%20b/screens');
    expect(parseHash(screensHref('a b'))).toEqual({ name: 'screens', slug: 'a b' });
    expect(hrefFor({ name: 'crew' })).toBe('#/crew');
    expect(hrefFor({ name: 'achievements' })).toBe('#/achievements');
    expect(hrefFor({ name: 'not-found', hash: '#/nowhere' })).toBe('#/nowhere');
  });

  it('links into the classic view at /', () => {
    expect(classicHref.job('x y')).toBe('/#/job/x%20y');
    expect(classicHref.costs()).toBe('/#/costs');
  });

  it('reads what the classic view asks to open after the route', () => {
    expect(openFromHash('#/?open=new-job')).toBe('new-job');
    expect(openFromHash('#/job/alpha?open=options')).toBe('options');
    expect(openFromHash('#/job/alpha?theme=glass&open=options')).toBe('options');
    expect(parseHash('#/job/alpha?open=options')).toEqual({ name: 'job', slug: 'alpha' });
    for (const hash of ['#/', '#/job/alpha', '#/?open=settings', '#/?theme=glass', '']) expect(openFromHash(hash)).toBeNull();
  });

  it('the open quick look on Jobs is ?peek=<slug> after the hash, and changes nothing about the route', () => {
    expect(parseHash('#/?peek=customer-merge')).toEqual({ name: 'home' });
    expect(parseHash('#/jobs?peek=customer-merge')).toEqual({ name: 'home' });
    expect(peekFromHash('#/jobs?peek=customer-merge')).toBe('customer-merge');
    expect(peekFromHash('#/?theme=glass&peek=a%20b')).toBe('a b');
    for (const hash of ['#/', '#/jobs', '#/?peek=', '#/?theme=glass', '']) expect(peekFromHash(hash)).toBeNull();
  });

  it('withPeek sets or drops the quick look and keeps the route and the other words', () => {
    expect(withPeek('#/', 'alpha')).toBe('#/?peek=alpha');
    expect(withPeek('', 'alpha')).toBe('#/?peek=alpha');
    expect(withPeek('#/jobs', 'alpha')).toBe('#/jobs?peek=alpha');
    expect(withPeek('#/jobs?peek=alpha', 'beta')).toBe('#/jobs?peek=beta');
    expect(withPeek('#/?theme=glass', 'alpha')).toBe('#/?theme=glass&peek=alpha');
    expect(withPeek('#/?theme=glass&peek=alpha', null)).toBe('#/?theme=glass');
    expect(withPeek('#/jobs?peek=alpha', null)).toBe('#/jobs');
    expect(peekFromHash(withPeek('#/', 'a b/c'))).toBe('a b/c');
  });

  // The new job page (Part 3): its conversation and its overview each have an address.
  it('a job’s conversation and overview have their own addresses', () => {
    expect(parseHash('#/job/alpha/conversation')).toEqual({ name: 'job', slug: 'alpha', view: 'conversation' });
    expect(parseHash('#/job/alpha/overview')).toEqual({ name: 'job', slug: 'alpha', view: 'overview' });
    expect(parseHash('#/job/alpha/overview/')).toEqual({ name: 'job', slug: 'alpha', view: 'overview' });
    expect(parseHash('#/job/alpha/conversation?theme=glass')).toEqual({ name: 'job', slug: 'alpha', view: 'conversation' });
    expect(jobViewHref('alpha', 'conversation')).toBe('#/job/alpha/conversation');
    expect(jobViewHref('a b/c', 'overview')).toBe('#/job/a%20b%2Fc/overview');
    expect(parseHash(jobViewHref('a b/c', 'overview'))).toEqual({ name: 'job', slug: 'a b/c', view: 'overview' });
    // The job's own address has no view at all, and still links the same way.
    expect(parseHash('#/job/alpha')).not.toHaveProperty('view');
    expect(hrefFor({ name: 'job', slug: 'alpha' })).toBe('#/job/alpha');
    expect(jobHref('alpha')).toBe('#/job/alpha');
    // Only those two words.
    expect(parseHash('#/job/alpha/talk')).toEqual({ name: 'not-found', hash: '#/job/alpha/talk' });
    expect(parseHash('#/job/alpha/conversation/x')).toEqual({ name: 'not-found', hash: '#/job/alpha/conversation/x' });
    // The page is still the job's.
    expect(pageName(parseHash('#/job/alpha/conversation'), 'Pause a service')).toBe('Pause a service');
  });

  it('a step’s address is unchanged', () => {
    expect(parseHash('#/job/alpha/stage/spec')).toEqual({ name: 'stage', slug: 'alpha', stop: 'spec' });
    expect(parseHash('#/job/alpha/stage/test/')).toEqual({ name: 'stage', slug: 'alpha', stop: 'test' });
    expect(parseHash('#/job/alpha/stage/nowhere')).toEqual({ name: 'not-found', hash: '#/job/alpha/stage/nowhere' });
    expect(stageHref('a b', 'review')).toBe('#/job/a%20b/stage/review');
    expect(parseHash(stageHref('a b', 'review'))).toEqual({ name: 'stage', slug: 'a b', stop: 'review' });
  });

  it('replaceHash changes the address with no new history entry and no hashchange', async () => {
    const settle = () => new Promise((r) => setTimeout(r, 20));
    window.location.hash = '#/job/alpha';
    await settle();
    const entries = window.history.length;
    const heard = vi.fn();
    window.addEventListener('hashchange', heard);
    try {
      replaceHash(stageHref('alpha', 'spec'));
      await settle();
      expect(window.location.hash).toBe('#/job/alpha/stage/spec');
      expect(window.history.length).toBe(entries);
      expect(heard).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('hashchange', heard);
      window.location.hash = '';
      await settle();
    }
  });
  // Review of Task 15a, fix 1: after replaceHash the route the app holds is the address just written,
  // so a later link to the address it started at is a change, and opens it.
  it('replaceHash moves the route the app holds, with no new history entry', async () => {
    const settle = () => new Promise((r) => setTimeout(r, 20));
    window.location.hash = '#/job/alpha/stage/test';
    await settle();
    const entries = window.history.length;
    const { result, unmount } = renderHook(() => useRoute());
    try {
      expect(result.current).toEqual({ name: 'stage', slug: 'alpha', stop: 'test' });
      act(() => { replaceHash(stageHref('alpha', 'spec')); });
      expect(result.current).toEqual({ name: 'stage', slug: 'alpha', stop: 'spec' });
      expect(window.history.length).toBe(entries);
      // A link back to the step it started at is a change again.
      await act(async () => { window.location.hash = '#/job/alpha/stage/test'; await settle(); });
      expect(result.current).toEqual({ name: 'stage', slug: 'alpha', stop: 'test' });
    } finally {
      unmount();
      window.location.hash = '';
      await settle();
    }
  });
});

describe('the new job page’s reader address (#/job/<slug>/read/<kind>/<id>)', () => {
  it('round-trips a reader target, the id escaped (ids carry : and /)', () => {
    const route = { name: 'job', slug: 'orbit-905-crew', read: { kind: 'brief', id: 'brief:briefs/015-review.md' } } as const;
    const href = hrefFor(route);
    expect(href).toBe('#/job/orbit-905-crew/read/brief/brief%3Abriefs%2F015-review.md');
    expect(parseHash(href)).toEqual(route);
    expect(readHref('orbit-905-crew', { kind: 'conversation', id: 'conversation' })).toBe('#/job/orbit-905-crew/read/conversation/conversation');
    expect(parseHash('#/job/a/read/doc/docs%2Fplan.md/')).toEqual({ name: 'job', slug: 'a', read: { kind: 'doc', id: 'docs/plan.md' } });
    expect(parseHash('#/job/a/read/doc/docs%2Fplan.md?theme=x')).toEqual({ name: 'job', slug: 'a', read: { kind: 'doc', id: 'docs/plan.md' } });
  });

  it('an unknown kind, a missing id or a bad escape is not a page', () => {
    expect(parseHash('#/job/a/read/nonsense/x').name).toBe('not-found');
    expect(parseHash('#/job/a/read/doc').name).toBe('not-found');
    expect(parseHash('#/job/a/read/doc/%E0%A4%A').name).toBe('not-found');
  });

  it('the old addresses stay as they were', () => {
    expect(parseHash('#/job/a')).toEqual({ name: 'job', slug: 'a' });
    expect(parseHash('#/job/a/stage/review')).toEqual({ name: 'stage', slug: 'a', stop: 'review' });
    expect(parseHash('#/job/a/conversation')).toEqual({ name: 'job', slug: 'a', view: 'conversation' });
    expect(parseHash('#/job/a/overview')).toEqual({ name: 'job', slug: 'a', view: 'overview' });
    expect(parseHash('#/job/a/id/FR-001')).toEqual({ name: 'job', slug: 'a' });
  });
});
