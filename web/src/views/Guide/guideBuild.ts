// The user guide (docs/guide/*.md) made into the app's Guide pages at build time (vite.config.ts's
// `starbase-guide` plugin serves the result as the module `virtual:starbase-guide`). Only the build
// and the tests import this file: it reads the disk.
//
// Each page is rendered with the server's own Markdown renderer (dashboard/lib/markdown.js: raw HTML
// shown as text, headings with h-<slug> ids, no inline style), then:
//   - its first heading becomes the page's title (the Guide page shows it as the page's heading);
//   - a link to another guide page (`03-jobs.md`, `05-deciding.md#the-message-box`, `README.md`)
//     becomes the app's own address (#/guide/03-jobs, #/guide/05-deciding/the-message-box, #/guide);
//   - a link to another file of the repository (../install.md, ../../README.md#install) becomes plain
//     words: the website must never link into the repository;
//   - a picture (img/jobs.png) points at the copy the build puts under guide/img/ beside the app,
//     from the app's base (/next/ on the laptop, / on the website), with its size so nothing moves;
//   - each heading gets a # link to its own address.
// The README is the contents page; its table's links give the pages' order.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BRAND } from '../../app/brand.ts';

export interface GuidePage {
  /** The file's name without .md ('03-jobs'); the README is 'contents'. */
  id: string;
  /** Its number in the contents (3), or null for the contents page. */
  n: number | null;
  /** The page's first heading, without its number: 'The Jobs page'. */
  title: string;
  /** The rendered page, without its first heading. */
  html: string;
}

export interface GuideBuild {
  pages: GuidePage[];
  /** The pictures the pages show, by file name (img/<name> in the guide's folder). */
  images: string[];
  /** Links that point at a guide page's section that isn't there: the link opens the page's top instead. */
  warnings: string[];
}

export const CONTENTS_ID = 'contents';

/** What a file of the repository named in the guide is, as its words' hover text. */
export const FILE_NOTE = `A file in ${BRAND.name}’s own folder on your laptop.`;

/** The app's address for a guide page and, optionally, one of its sections (router.ts's #/guide). */
export function guideAddress(id: string, section?: string): string {
  const page = id === CONTENTS_ID ? (section ? `/${CONTENTS_ID}` : '') : `/${id}`;
  return `#/guide${page}${section ? `/${section}` : ''}`;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'" };
const decode = (s: string) => s.replace(/&(amp|lt|gt|quot|#39|#x27);/g, (_, e: string) => ENTITIES[e]);
const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const textOf = (html: string) => decode(html.replace(/<[^>]*>/g, ''));

/** GitHub's heading anchor, which the guide's own links use: lower case, punctuation dropped, each space a hyphen. */
export function githubSlug(text: string): string {
  return text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
}

/** A PNG's width and height, from its header; null when it isn't a PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** The guide pages' files in the README's order (its links to NN-name.md, each once). */
export function pageOrder(readme: string, files: readonly string[]): string[] {
  const seen: string[] = [];
  for (const m of readme.matchAll(/\]\(([\w-]+)\.md(?:#[^)]*)?\)/g)) {
    const id = m[1];
    if (id !== 'README' && files.includes(`${id}.md`) && !seen.includes(id)) seen.push(id);
  }
  return seen;
}

interface Rendered { id: string; n: number | null; title: string; html: string; anchors: Map<string, string> }

/** Renders one page and lists its headings' ids (h-<slug>) by their GitHub anchor and by their own slug. */
function renderPage(id: string, md: string, render: (md: string) => string): Rendered {
  let html = render(md);
  let title = id;
  const h1 = /^\s*<h1 id="[^"]*">([\s\S]*?)<\/h1>\n?/.exec(html);
  if (h1) { title = textOf(h1[1]).trim(); html = html.slice(h1.index + h1[0].length); }
  const numbered = /^(\d+)\.\s+(.*)$/.exec(title);
  const anchors = new Map<string, string>();
  for (const m of html.matchAll(/<h[2-6] id="h-([^"]+)">([\s\S]*?)<\/h[2-6]>/g)) {
    anchors.set(m[1], m[1]);
    const gh = githubSlug(textOf(m[2]));
    if (!anchors.has(gh)) anchors.set(gh, m[1]);
  }
  return { id, n: numbered ? Number(numbered[1]) : null, title: numbered ? numbered[2] : title, html, anchors };
}

/**
 * The guide's pages from the files in `dir` (docs/guide): `render` is dashboard/lib/markdown.js's
 * renderMarkdown, `base` the app's base ('/next/' or '/'), `size` a picture's width and height.
 */
export function buildGuide({ dir, render, base, size }: {
  dir: string;
  render: (md: string) => string;
  base: string;
  size?: (name: string) => { width: number; height: number } | null;
}): GuideBuild {
  const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
  const read = (f: string) => readFileSync(path.join(dir, f), 'utf8');
  const readme = read('README.md');
  const ids = pageOrder(readme, files);
  const rendered = [renderPage(CONTENTS_ID, readme, render), ...ids.map((id) => renderPage(id, read(`${id}.md`), render))];
  const byId = new Map(rendered.map((r) => [r.id, r]));
  const images: string[] = [];
  const warnings: string[] = [];
  const imgBase = `${base.endsWith('/') ? base : `${base}/`}guide/img/`;

  const pages = rendered.map((page) => {
    const sectionIn = (target: Rendered, anchor: string): string | undefined => {
      if (!anchor) return undefined;
      const id = target.anchors.get(anchor) ?? target.anchors.get(githubSlug(decodeURIComponent(anchor)));
      if (!id) warnings.push(`${page.id}: no section "${anchor}" in ${target.id}`);
      return id;
    };
    let html = page.html.replace(/<a href="([^"]*)"([^>]*)>([\s\S]*?)<\/a>/g, (whole, rawHref: string, _attrs: string, inner: string) => {
      const href = decode(rawHref);
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return whole; // the web, mail: as they are
      const local = /^#(.+)$/.exec(href);
      if (local) return `<a href="${escapeAttr(guideAddress(page.id, sectionIn(page, local[1])))}">${inner}</a>`;
      const other = /^(?:\.\/)?([\w-]+)\.md(?:#(.*))?$/.exec(href);
      const target = other ? (other[1] === 'README' ? byId.get(CONTENTS_ID) : byId.get(other[1])) : undefined;
      if (other && target) return `<a href="${escapeAttr(guideAddress(target.id, sectionIn(target, other[2] ?? '')))}">${inner}</a>`;
      // Another file of the repository: its name stays, as words.
      return `<span class="ug-file" title="${FILE_NOTE}">${inner}</span>`;
    });
    html = html.replace(/<img src="([^"]*)" alt="([^"]*)">/g, (whole, src: string, alt: string) => {
      const pic = /^(?:\.\/)?img\/([\w.-]+\.(?:png|jpe?g|webp|gif|svg))$/i.exec(decode(src));
      if (!pic) return whole;
      if (!images.includes(pic[1])) images.push(pic[1]);
      const dims = size?.(pic[1]);
      return `<img src="${escapeAttr(imgBase + pic[1])}" alt="${alt}"${dims ? ` width="${dims.width}" height="${dims.height}"` : ''} loading="lazy">`;
    });
    html = html.replace(/<(h[2-6]) id="h-([^"]+)">([\s\S]*?)<\/\1>/g, (_, tag: string, id: string, inner: string) =>
      `<${tag} id="h-${id}">${inner} <a class="ug-anchor" href="${escapeAttr(guideAddress(page.id, id))}" aria-label="This section’s address" title="This section’s own address: copy it, or open it">#</a></${tag}>`);
    return { id: page.id, n: page.n, title: page.title, html };
  });
  return { pages, images, warnings };
}

/** The server's Markdown renderer (dashboard/lib/markdown.js), loaded from the repository. */
export async function loadRenderer(repoRoot: string): Promise<(md: string) => string> {
  const mod = await import(/* @vite-ignore */ pathToFileURL(path.join(repoRoot, 'dashboard', 'lib', 'markdown.js')).href) as { renderMarkdown: (md: string) => string };
  return (md) => mod.renderMarkdown(md);
}

/** A picture's size read from the guide's img folder (PNG only; others get none). */
export function imageSizer(dir: string) {
  return (name: string) => {
    try { return pngSize(readFileSync(path.join(dir, 'img', name))); } catch { return null; }
  };
}
