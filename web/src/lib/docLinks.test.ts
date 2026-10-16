import { describe, expect, it } from 'vitest';
import { findAnchor, linkAction, resolveDocPath } from './docLinks';

describe('links in rendered documents', () => {
  it('routes, sections and web links', () => {
    expect(linkAction('#/job/alpha/id/FR-001')).toEqual({ kind: 'route' });
    expect(linkAction('#s1-the-migration')).toEqual({ kind: 'anchor', id: 's1-the-migration' });
    expect(linkAction('#caf%C3%A9')).toEqual({ kind: 'anchor', id: 'café' });
    for (const href of ['https://example.com', 'http://x.test/a.md', 'mailto:a@b.test', 'vscode://file/x.md']) expect(linkAction(href).kind, href).toBe('external');
  });

  it('a .md link opens a document of the job, from the folder of the one it is in', () => {
    expect(linkAction('findings.md')).toEqual({ kind: 'doc', file: 'findings.md' });
    expect(linkAction('./notes.md#top')).toEqual({ kind: 'doc', file: 'notes.md' });
    expect(linkAction('../review.md', 'briefs')).toEqual({ kind: 'doc', file: 'review.md' });
    expect(linkAction('002-plan-detail.md', 'briefs')).toEqual({ kind: 'doc', file: 'briefs/002-plan-detail.md' });
    expect(linkAction('My%20Plan.MD')).toEqual({ kind: 'doc', file: 'My Plan.MD' });
  });

  it('anything else is blocked, with a hint', () => {
    for (const href of ['//evil.test/x.md', '/\\evil.test', '/etc/passwd.md', '../outside.md', '.hidden/x.md', 'src/app.ts', 'picture.png']) {
      const a = linkAction(href);
      expect(a.kind, href).toBe('blocked');
      expect(a.kind === 'blocked' && a.hint, href).toContain(href);
    }
  });

  it('resolves inside the job folder only', () => {
    expect(resolveDocPath('', 'a/../b.md')).toBe('b.md');
    expect(resolveDocPath('briefs', '../../x.md')).toBeNull();
    expect(resolveDocPath('', '../x.md')).toBeNull();
    expect(resolveDocPath('', 'a/.git/x.md')).toBeNull();
  });

  it('finds a section by its id or its heading anchor h-<id>', () => {
    const root = document.createElement('div');
    root.innerHTML = '<h2 id="h-summary">Summary</h2><p id="note">x</p>';
    expect(findAnchor(root, 'summary')?.textContent).toBe('Summary');
    expect(findAnchor(root, 'Summary')?.textContent).toBe('Summary');
    expect(findAnchor(root, 'h-summary')?.textContent).toBe('Summary');
    expect(findAnchor(root, 'note')?.id).toBe('note');
    expect(findAnchor(root, 'nope')).toBeNull();
    expect(findAnchor(root, '')).toBeNull();
  });
});
