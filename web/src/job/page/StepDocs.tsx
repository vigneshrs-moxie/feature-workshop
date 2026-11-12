// The documents from one step (design 3.2): a row each with its name, version and when it changed
// (the Docs tab's own rows). A click opens it in place, in the Docs tab's reader, with Back to the
// list; a new `request` (a document link, ⌘K) opens its file, or the list when it has none. The
// wireframes page is not a document: it opens in the Screens page, as in the Docs tab.
import { useEffect, useRef, useState } from 'react';
import type { JobDocEntry } from '../../api/types';
import { useUi } from '../../app/ui';
import { useNow } from '../../lib/time';
import { DocItem, DocReader } from '../../panes/Preview/DocsTab';

export function StepDocs({ slug, docs, request }: { slug: string; docs: JobDocEntry[]; request?: { n: number; file: string | null } }) {
  const ui = useUi();
  const now = useNow();
  const [file, setFile] = useState<string | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const lastPicked = useRef<string | null>(null);

  // A request this list hasn't acted on (one present when it mounts counts as new).
  const seen = useRef<number | null>(null);
  if (request && request.n !== seen.current) {
    seen.current = request.n;
    const wanted = request.file;
    if (wanted !== file) setFile(wanted);
    if (wanted) lastPicked.current = wanted;
  }

  // Back to the list: the focus goes to the document you were reading.
  useEffect(() => {
    if (file !== null || !lastPicked.current) return;
    const picked = lastPicked.current;
    [...(list.current?.querySelectorAll<HTMLButtonElement>('.doc-item') ?? [])].find((b) => b.dataset.file === picked)?.focus();
  }, [file]);

  const pick = (f: string) => {
    if (docs.find((d) => d.file === f)?.type === 'html') { ui.openScreens(slug); return; }
    lastPicked.current = f;
    setFile(f);
  };

  if (file) {
    return (
      <div className="sb-docs">
        <DocReader key={file} slug={slug} file={file} entry={docs.find((d) => d.file === file) ?? null} now={now} onBack={() => setFile(null)} />
      </div>
    );
  }
  if (docs.length === 0) return <p className="muted sb-docs-empty">No documents from this step yet.</p>;
  return (
    <ul ref={list} className="doc-items sb-docs">
      {docs.map((d) => <DocItem key={d.file} d={d} now={now} onPick={pick} />)}
    </ul>
  );
}
