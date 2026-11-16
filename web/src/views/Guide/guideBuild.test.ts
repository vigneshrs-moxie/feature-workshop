// @vitest-environment node
// The guide made into the app's pages at build time (guideBuild.ts, vite.config.ts's starbase-guide
// plugin): rendered by the server's own renderer, links between pages turned into the app's
// addresses, links into the repository turned into words, pictures pointed at the build's copies.
import { existsSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildGuide, FILE_NOTE, githubSlug, guideAddress, imageSizer, loadRenderer, pageOrder, pngSize, type GuideBuild } from './guideBuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const GUIDE = path.join(ROOT, 'docs', 'guide');
let render: (md: string) => string;
beforeAll(async () => { render = await loadRenderer(ROOT); });

/** A made-up guide of two pages, in a folder of its own. */
function tinyGuide(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'guide-'));
  mkdirSync(path.join(dir, 'img'));
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, name), text);
  return dir;
}

const README = '# Starbase user guide\n\n| # | Page |\n|---|---|\n| 1 | [Start here](01-start.md) |\n| 2 | [Jobs](02-jobs.md) |\n\nMore in the [README](../../README.md#install) and [docs/install.md](../install.md).\n';
const START = '# 1. Start here\n\nSee [the Jobs page](02-jobs.md), its [search](02-jobs.md#find-a-job-the-search-box), [below](#the-words) and [the contents](README.md).\n\n![Jobs: the lanes](img/jobs.png)\n\n## The words\n\nA [site](https://example.test/x).\n';
const JOBS = '# 2. The Jobs page\n\n## Find a job: the search box\n\nType.\n';

describe('the guide build', () => {
  it('names the pages in the contents’ order, each title without its number', () => {
    const g = buildGuide({ dir: tinyGuide({ 'README.md': README, '01-start.md': START, '02-jobs.md': JOBS }), render, base: '/next/' });
    expect(g.pages.map((p) => [p.id, p.n, p.title])).toEqual([['contents', null, 'Starbase user guide'], ['01-start', 1, 'Start here'], ['02-jobs', 2, 'The Jobs page']]);
    // The first heading is the page's title, not part of its text.
    expect(g.pages[1].html).not.toMatch(/<h1/);
  });

  it('turns links between pages into the app’s addresses, sections included', () => {
    const g = buildGuide({ dir: tinyGuide({ 'README.md': README, '01-start.md': START, '02-jobs.md': JOBS }), render, base: '/next/' });
    const html = g.pages[1].html;
    expect(html).toContain('<a href="#/guide/02-jobs">the Jobs page</a>');
    expect(html).toContain('<a href="#/guide/02-jobs/find-a-job-the-search-box">search</a>');
    expect(html).toContain('<a href="#/guide/01-start/the-words">below</a>');
    expect(html).toContain('<a href="#/guide">the contents</a>');
    expect(g.warnings).toEqual([]);
    // The contents' table links to each page.
    expect(g.pages[0].html).toContain('<a href="#/guide/01-start">Start here</a>');
  });

  it('turns links into the repository into words, and keeps links to the web', () => {
    const g = buildGuide({ dir: tinyGuide({ 'README.md': README, '01-start.md': START, '02-jobs.md': JOBS }), render, base: '/' });
    expect(g.pages[0].html).toContain(`<span class="ug-file" title="${FILE_NOTE}">README</span>`);
    expect(FILE_NOTE).toBe('A file in Starbase’s own folder on your laptop.');
    expect(g.pages[0].html).toContain('>docs/install.md</span>');
    expect(g.pages[0].html).not.toMatch(/href="[^"]*\.\.\//);
    expect(g.pages[1].html).toContain('href="https://example.test/x" target="_blank" rel="noopener noreferrer"');
  });

  it('points each picture at the build’s copy under guide/img/, from the app’s base', () => {
    const files = { 'README.md': README, '01-start.md': START, '02-jobs.md': JOBS };
    const laptop = buildGuide({ dir: tinyGuide(files), render, base: '/next/', size: () => ({ width: 1440, height: 900 }) });
    expect(laptop.pages[1].html).toContain('<img src="/next/guide/img/jobs.png" alt="Jobs: the lanes" width="1440" height="900" loading="lazy">');
    expect(laptop.images).toEqual(['jobs.png']);
    const site = buildGuide({ dir: tinyGuide(files), render, base: '/' });
    expect(site.pages[1].html).toContain('<img src="/guide/img/jobs.png" alt="Jobs: the lanes" loading="lazy">');
  });

  it('gives each heading a link to its own address', () => {
    const g = buildGuide({ dir: tinyGuide({ 'README.md': README, '01-start.md': START, '02-jobs.md': JOBS }), render, base: '/' });
    expect(g.pages[2].html).toContain('<h2 id="h-find-a-job-the-search-box">Find a job: the search box <a class="ug-anchor" href="#/guide/02-jobs/find-a-job-the-search-box"');
  });

  it('says when a link names a section that isn’t there, and opens the page’s top', () => {
    const start = '# 1. Start here\n\n[gone](02-jobs.md#no-such-part)\n';
    const g = buildGuide({ dir: tinyGuide({ 'README.md': README, '01-start.md': start, '02-jobs.md': JOBS }), render, base: '/' });
    expect(g.pages[1].html).toContain('<a href="#/guide/02-jobs">gone</a>');
    expect(g.warnings).toEqual(['01-start: no section "no-such-part" in 02-jobs']);
  });

  it('has small helpers that read the order, anchors and picture sizes', () => {
    expect(pageOrder(README, ['01-start.md', '02-jobs.md', 'README.md'])).toEqual(['01-start', '02-jobs']);
    expect(githubSlug('The asks row and ⌘K: everyday requests')).toBe('the-asks-row-and-k-everyday-requests');
    expect(guideAddress('contents')).toBe('#/guide');
    expect(guideAddress('contents', 'about-this-guide')).toBe('#/guide/contents/about-this-guide');
    expect(guideAddress('04-a-job', 'addresses')).toBe('#/guide/04-a-job/addresses');
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47], 0);
    new DataView(png.buffer).setUint32(16, 1440);
    new DataView(png.buffer).setUint32(20, 900);
    expect(pngSize(png)).toEqual({ width: 1440, height: 900 });
    expect(pngSize(new Uint8Array(30))).toBeNull();
  });
});

describe('the real guide (docs/guide)', () => {
  let g: GuideBuild;
  beforeAll(() => { g = buildGuide({ dir: GUIDE, render, base: '/next/', size: imageSizer(GUIDE) }); });

  it('has the contents and its 12 pages, in order', () => {
    expect(g.pages.map((p) => p.n)).toEqual([null, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(g.pages.map((p) => p.id)).toContain('03-jobs');
    expect(g.pages.every((p) => p.title && p.html.length > 200)).toBe(true);
  });

  it('every link between pages finds its page and section', () => {
    expect(g.warnings).toEqual([]);
    for (const p of g.pages) expect(p.html, p.id).not.toMatch(/href="[^"#]*\.md/);
  });

  it('never links into the repository, and has no inline style (the CSP is style-src self)', () => {
    for (const p of g.pages) {
      expect(p.html, p.id).not.toMatch(/href="\.\.?\//);
      expect(p.html, p.id).not.toMatch(/\sstyle\s*=/i);
      expect(p.html, p.id).not.toMatch(/<style[\s>]/i);
    }
  });

  it('shows every picture from guide/img/, each one there and sized', () => {
    expect(g.images.length).toBeGreaterThan(5);
    for (const name of g.images) expect(existsSync(path.join(GUIDE, 'img', name)), name).toBe(true);
    const jobs = g.pages.find((p) => p.id === '03-jobs')!;
    expect(jobs.html).toMatch(/<img src="\/next\/guide\/img\/jobs\.png" alt="[^"]+" width="\d+" height="\d+" loading="lazy">/);
    for (const p of g.pages) expect(p.html, p.id).not.toMatch(/<img src="img\//);
  });
});
