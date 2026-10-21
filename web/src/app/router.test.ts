import { describe, expect, it } from 'vitest';
import { classicHref, hrefFor, jobHref, openFromHash, parseHash } from './router';

describe('hash router', () => {
  it.each([
    ['', { name: 'home' }],
    ['#', { name: 'home' }],
    ['#/', { name: 'home' }],
    ['#/job/alpha', { name: 'job', slug: 'alpha' }],
    ['#/job/alpha/', { name: 'job', slug: 'alpha' }],
    ['#/job/with%20space', { name: 'job', slug: 'with space' }],
    ['#/job/', { name: 'not-found', hash: '#/job/' }],
    ['#/job/a/b', { name: 'not-found', hash: '#/job/a/b' }],
    ['#/job/alpha/id/FR-001', { name: 'job', slug: 'alpha' }],
    ['#/job/%E0%A4%A', { name: 'not-found', hash: '#/job/%E0%A4%A' }],
    ['#/costs', { name: 'not-found', hash: '#/costs' }],
    ['#/settings', { name: 'settings' }],
    ['#/settings/', { name: 'settings' }],
    ['#/settings/x', { name: 'not-found', hash: '#/settings/x' }],
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
});
