// Changes in the reader (job page rebuild, Task 14; design brief "Changes"): the commits as a small list
// above, the picked commit's files on the left, the picked file's diff on the right at full width.
//
// - The commits come from today's route (reader/branch.ts); the newest is picked, and its diff is
//   asked for as soon as the list is known, so its first file shows with no click. Hovering a commit
//   asks for its diff ahead too.
// - A file pick paints in the same frame when its commit's diff is held (a diff holds every file of
//   its commit). The file list is its own scroll column and only marks the pick, so a pick never moves it.
// - A long diff draws in chunks (DIFF_CHUNK lines each): the first DIFF_FIRST_LINES at once, the next
//   ones when the end comes into view or on `Show the next …`. Chunks already drawn are never drawn
//   again, and the browser skips the ones out of view (content-visibility), so 5,000 lines never
//   freeze the reader.
// - On the website the commits stay on the laptop (plan decision 8): one line, nothing asked.

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BRAND } from '../../app/brand';
import { Button } from '../../components/Button';
import { useWorkshop } from '../../state/store';
import { sinceWords } from '../left/YourMove';
import { useJob, useJobStore } from '../useJob';
import { loadCommits, loadDiff, setPick, useBranch, type BranchCommit, type BranchFile } from './branch';
import { ReaderBody } from './ReaderBody';

/** Lines in one chunk of a diff, and how many draw at first. */
export const DIFF_CHUNK = 200;
export const DIFF_FIRST_LINES = 2 * DIFF_CHUNK;

const nameOf = (p: string) => p.split('/').pop() ?? p;
/** The picked commit: by its sha, or by a short sha as the Foreman writes it (What you asked, Task 18). */
const pickedCommit = (commits: BranchCommit[], sha: string | null) => (sha ? commits.find((c) => c.sha === sha) ?? (sha.length >= 7 ? commits.find((c) => c.sha.startsWith(sha)) : undefined) : undefined);
/** The picked file: by its path, or by the end of it (`EmployeesTable.tsx`, `src/EmployeesTable.tsx`). */
const pickedFile = (files: BranchFile[], path: string | null) => (path ? files.find((f) => f.path === path) ?? files.find((f) => f.path.endsWith(`/${path}`)) : undefined);
const folderOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

export function ChangesView() {
  const store = useJobStore();
  const { api } = useWorkshop();
  const slug = useJob((s) => s.slug);
  const hosted = useJob((s) => Boolean(s.payload?.hosted)) || Boolean(api.hosted?.());
  const branch = useBranch(store);

  // The list on open (held → at once; read again behind it).
  useEffect(() => { if (!hosted) void loadCommits(store, api, slug); }, [store, api, slug, hosted]);

  const commits = branch.commits ?? [];
  const commit = pickedCommit(commits, branch.pick.sha) ?? commits[0] ?? null;
  // The newest commit's diff, fetched ahead of any pick.
  useEffect(() => { if (!hosted && commit) void loadDiff(store, api, slug, commit.sha); }, [store, api, slug, hosted, commit?.sha]);
  // The commit first shown stays shown: a newer one arriving on the list's re-read never replaces what he reads.
  useEffect(() => { if (!branch.pick.sha && commit) setPick(store, { sha: commit.sha, path: branch.pick.path }); }, [store, commit?.sha, branch.pick.sha]);

  if (hosted) return <ReaderBody view="changes" place="changes:changes"><p className="jp2-notyet">The commits show on your laptop.</p></ReaderBody>;
  if (!branch.commits) {
    return (
      <ReaderBody view="changes" place="changes:changes">
        {branch.error ? <Failed what="commits" why={branch.error} onAgain={() => void loadCommits(store, api, slug)} /> : null}
      </ReaderBody>
    );
  }
  if (!commits.length) return <ReaderBody view="changes" place="changes:changes"><p className="jp2-notyet">{branch.note ?? 'No commits on the branch yet.'}</p></ReaderBody>;

  const diff = commit ? branch.diffs.get(commit.sha) ?? null : null;
  const files: BranchFile[] = commit && commit.files.length ? commit.files : diff?.files.length ? diff.files : (diff?.patchFiles ?? []).map((f) => ({ path: f.path, added: null, removed: null }));
  const path = pickedFile(files, branch.pick.path)?.path ?? files[0]?.path ?? null;
  const pickCommit = (c: BranchCommit) => setPick(store, { sha: c.sha, path: null });
  const pickFile = (p: string) => setPick(store, { sha: commit?.sha ?? null, path: p });

  return (
    <ReaderBody view="changes" place="changes:changes" className="jp2-chb">
      <div className="jp2-ch-commits" role="list" aria-label="Commits, newest first">
        {commits.map((c) => (
          <CommitRow key={c.sha} c={c} on={c.sha === commit?.sha} onPick={pickCommit} onAhead={(x) => void loadDiff(store, api, slug, x.sha)} />
        ))}
      </div>
      <div className="jp2-ch-p">
        <FileList files={files} on={path} onPick={pickFile} />
        <DiffColumn place={commit ? `${commit.sha}:${path ?? ''}` : ''}>
          {commit && <Diff sha={commit.sha} path={path} onAgain={() => void loadDiff(store, api, slug, commit.sha)} />}
        </DiffColumn>
      </div>
    </ReaderBody>
  );
}

/** The diff's own scroll column: another file (or commit) starts at its top, not where the last one was left. */
function DiffColumn({ place, children }: { place: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (ref.current) ref.current.scrollTop = 0; }, [place]);
  return <div ref={ref} className="jp2-ch-diff">{children}</div>;
}

/** How long the pointer (or the focus) rests on a commit before its diff is fetched ahead. */
export const AHEAD_MS = 150;

function Failed({ what, why, onAgain }: { what: string; why: string; onAgain(): void }) {
  return (
    <div className="jp2-ch-failed">
      <p className="jp2-dim" role="alert">Couldn’t read the {what}: {why}</p>
      <Button size="sm" onClick={onAgain} title={`Ask ${BRAND.name} again.`}>Try again</Button>
    </div>
  );
}

const Plus = ({ f }: { f: { added: number | null; removed: number | null } }) => (
  <span className="jp2-ch-n"><span className="jp2-ch-pl">+{f.added ?? '?'}</span> <span className="jp2-ch-mi">−{f.removed ?? '?'}</span></span>
);

const CommitRow = memo(function CommitRow({ c, on, onPick, onAhead }: { c: BranchCommit; on: boolean; onPick(c: BranchCommit): void; onAhead(c: BranchCommit): void }) {
  // Fetched ahead only after a short rest, so running the pointer down the list asks for nothing.
  const wait = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rest = () => { if (!wait.current) wait.current = setTimeout(() => { wait.current = null; onAhead(c); }, AHEAD_MS); };
  const away = () => { if (wait.current) { clearTimeout(wait.current); wait.current = null; } };
  useEffect(() => away, []);
  const added = c.files.reduce((n, f) => n + (f.added ?? 0), 0);
  const removed = c.files.reduce((n, f) => n + (f.removed ?? 0), 0);
  return (
    <div role="listitem">
      <button type="button" className="jp2-ch-c" aria-current={on ? 'true' : undefined} onClick={() => onPick(c)} onMouseEnter={rest} onMouseLeave={away} onFocus={rest} onBlur={away} title={c.subject}>
        <span className="jp2-ch-sha">{c.short}</span>
        <span className="jp2-ch-s">{c.subject}</span>
        {c.files.length > 0 && <Plus f={{ added, removed }} />}
        <time className="jp2-ch-t" dateTime={c.date ?? undefined}>{sinceWords(c.date)}</time>
      </button>
    </div>
  );
});

/** The picked commit's files: its own scroll column; a pick only moves the mark. */
const FileList = memo(function FileList({ files, on, onPick }: { files: BranchFile[]; on: string | null; onPick(p: string): void }) {
  return (
    <div className="jp2-ch-files" role="list" aria-label="Files in this commit">
      {files.map((f) => (
        <div key={f.path} role="listitem">
          <button type="button" className="jp2-ch-f" data-path={f.path} aria-current={f.path === on ? 'true' : undefined} onClick={() => onPick(f.path)} title={f.path}>
            <span className="jp2-ch-fn">{nameOf(f.path)}</span>
            <span className="jp2-ch-fd">{folderOf(f.path)}</span>
            {(f.added !== null || f.removed !== null) && <Plus f={f} />}
          </button>
        </div>
      ))}
    </div>
  );
});

/** The picked file's diff, from the commit's diff when it is held. */
function Diff({ sha, path, onAgain }: { sha: string; path: string | null; onAgain(): void }) {
  const store = useJobStore();
  const branch = useBranch(store);
  const diff = branch.diffs.get(sha) ?? null;
  const error = branch.diffErrors.get(sha) ?? null;
  if (!diff) return error ? <Failed what="change" why={error} onAgain={onAgain} /> : <p className="jp2-dim" role="status">Reading the change…</p>;
  const file = diff.patchFiles.find((f) => f.path === path) ?? null;
  return (
    <>
      {path && <div className="jp2-ch-dh">{path}</div>}
      {file ? <DiffLines key={`${sha}:${file.path}`} lines={file.lines} sha={sha} path={file.path} /> : <p className="jp2-dim">{diff.patchFiles.length ? 'No lines to show for this file (a binary file, or only renamed).' : 'No file changes in this commit.'}</p>}
      {diff.truncated && <p className="jp2-dim jp2-ch-cut">Only the start of this change is shown: it is very large.</p>}
    </>
  );
}

interface Line { text: string; cls: string; ln: number | null }

/** Each line's look and, for added and kept lines, its line number in the new file. One pass. */
function shapeLines(lines: string[]): Line[] {
  const out: Line[] = new Array(lines.length);
  let ln = 0;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i];
    if (t.startsWith('@@')) {
      const m = /\+(\d+)/.exec(t);
      ln = m ? Number(m[1]) : 0;
      out[i] = { text: t, cls: 'jp2-dl is-hunk', ln: null };
    } else if (t.startsWith('+')) out[i] = { text: t, cls: 'jp2-dl is-add', ln: ln++ };
    else if (t.startsWith('-')) out[i] = { text: t, cls: 'jp2-dl is-del', ln: null };
    else if (t.startsWith('\\')) out[i] = { text: t, cls: 'jp2-dl is-note', ln: null };
    else out[i] = { text: t, cls: 'jp2-dl', ln: ln++ };
  }
  return out;
}

const Chunk = memo(function Chunk({ lines }: { lines: Line[] }) {
  return (
    <div className="jp2-dl-chunk">
      {lines.map((l, i) => <div key={i} className={l.cls} data-ln={l.ln ?? undefined}>{l.text || ' '}</div>)}
    </div>
  );
});

/** A file's lines in chunks: the first ones at once, the next when the end comes into view or on a click. */
function DiffLines({ lines, sha, path }: { lines: string[]; sha: string; path: string }) {
  const shaped = useMemo(() => shapeLines(lines), [lines]);
  const [shown, setShown] = useState(Math.min(shaped.length, DIFF_FIRST_LINES));
  const end = useRef<HTMLButtonElement>(null);
  const left = shaped.length - shown;
  const next = Math.min(left, DIFF_FIRST_LINES);
  useEffect(() => {
    const el = end.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    // Its root is the column that scrolls the diff (the reader's body on the phone), so the next lines
    // are drawn 600 px before the end comes into view.
    const root = el.closest('.jp2[data-layout="phone"]') ? el.closest('.jp2-rv-body') : el.closest('.jp2-ch-diff');
    const io = new IntersectionObserver((seen) => {
      if (seen.some((e) => e.isIntersecting)) setShown((n) => Math.min(shaped.length, n + DIFF_FIRST_LINES));
    }, { root, rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [shaped.length, shown]);
  return (
    // The commit and file a note on one of its lines names (notes/Pointable.tsx).
    <div className="jp2-ch-df" data-sha={sha} data-short={sha.slice(0, 7)} data-path={path}>
      <ChunkList shaped={shaped} shown={shown} />
      {left > 0 && (
        <button ref={end} type="button" className="link-button jp2-ch-more" onClick={() => setShown((n) => Math.min(shaped.length, n + DIFF_FIRST_LINES))}>
          Show the next {next.toLocaleString('en-US')} lines · {left.toLocaleString('en-US')} more lines
        </button>
      )}
    </div>
  );
}

/** The chunks drawn so far; each chunk is the same array while the lines stay, so a drawn one is not drawn again. */
function ChunkList({ shaped, shown }: { shaped: Line[]; shown: number }) {
  const cache = useRef<{ of: Line[]; chunks: Line[][] }>({ of: shaped, chunks: [] });
  if (cache.current.of !== shaped) cache.current = { of: shaped, chunks: [] };
  const list = cache.current.chunks;
  for (let i = list.length; i * DIFF_CHUNK < shown; i++) list.push(shaped.slice(i * DIFF_CHUNK, (i + 1) * DIFF_CHUNK));
  const n = Math.ceil(shown / DIFF_CHUNK);
  return <>{list.slice(0, n).map((c, i) => <Chunk key={i} lines={c} />)}</>;
}
