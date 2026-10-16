import { describe, expect, it } from 'vitest';
import { classicHref, hrefFor, jobHref, parseHash } from './router';

describe('hash router', () => {
  it.each([
    ['', { name: 'home' }],
    ['#', { name: 'home' }],
    ['#/', { name: 'home' }],
    ['#/job/alpha', { name: 'job', slug: 'alpha' }],
    ['#/job/alpha/', { name: 'job', slug: 'alpha' }],
    ['#/job/with%20space', { name: 'job', slug: 'with space' }],
    ['#/job/', { name: 'home' }],
    ['#/job/a/b', { name: 'home' }],
    ['#/job/alpha/id/FR-001', { name: 'job', slug: 'alpha' }],
    ['#/job/%E0%A4%A', { name: 'home' }],
    ['#/costs', { name: 'home' }],
    ['#/settings', { name: 'settings' }],
    ['#/settings/', { name: 'settings' }],
    ['#/settings/x', { name: 'home' }],
    ['#/crew', { name: 'crew' }],
    ['#/crew/', { name: 'crew' }],
    ['#/crew?theme=pixel-crew', { name: 'crew' }],
    ['#/crew/x', { name: 'home' }],
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
  });

  it('links into the classic view at /', () => {
    expect(classicHref.job('x y')).toBe('/#/job/x%20y');
    expect(classicHref.costs()).toBe('/#/costs');
  });
});
