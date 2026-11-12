// The documents from one step (design 3.2): a row each with its name, version and when it changed
// (the Docs tab's own rows). A click opens it in place, in the Docs tab's reader, with Back to the
// list; a new `request` (a document link, ⌘K) opens its file, or the list when it has none, with the
// focus on its first document once the step's answer is in with one (none: the request is dropped).
// The focus never leaves a box he is typing in. The wireframes page is not a document: it opens in
// the Screens page, as in the Docs tab.
import { useEffect, useRef, useState } from 'react';
import type { JobDocEntry } from '../../api/types';
import { isTypingTarget } from '../../app/keyRegistry';
import { useUi } from '../../app/ui';
import { useNow } from '../../lib/time';
import { DocItem, DocReader } from '../../panes/Preview/DocsTab';

export function StepDocs({ slug, docs, request, loaded = true }: {
  slug: string; docs: JobDocEntry[]; request?: { n: number; file: string | null };
  /** The step's answer is in (its `docs` are known); while it is not, a request waits for them. */
  loaded?: boolean;
}) {
  const ui = useUi();
  const now = useNow();
  const [file, setFile] = useState<string | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const lastPicked = useRef<string | null>(null);

  // A request this list hasn't acted on (one present when it mounts counts as new: StepPanel hands
  // a request down only once, so picking the step again does not bring it back).
  const seen = useRef<number | null>(null);
  // A request with no file (⌘K Open docs): the focus goes to the first document once the step's
  // answer is in; an answer with no documents drops it, so a document arriving later never takes the focus.
  const focusFirst = useRef(false);
  const n = request?.n ?? null;
  const wanted = request?.file ?? null;
  useEffect(() => {
    if (n === null || n === seen.current) return;
    seen.current = n;
    if (wanted) lastPicked.current = wanted;
    focusFirst.current = !wanted;
    setFile(wanted);
  }, [n, wanted]);

  // Back to the list: the focus goes to the document you were reading.
  useEffect(() => {
    if (file !== null || !lastPicked.current || isTypingTarget(document.activeElement)) return;
    const picked = lastPicked.current;
    [...(list.current?.querySelectorAll<HTMLButtonElement>('.doc-item') ?? [])].find((b) => b.dataset.file === picked)?.focus();
  }, [file]);
  useEffect(() => {
    if (!focusFirst.current || file !== null || !loaded) return;
    focusFirst.current = false;
    // Never out of a box he is typing in (the message box, What should change?).
    if (isTypingTarget(document.activeElement)) return;
    list.current?.querySelector<HTMLButtonElement>('.doc-item')?.focus();
  });

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
