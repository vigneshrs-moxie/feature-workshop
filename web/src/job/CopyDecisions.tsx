// "Copy decisions": the job's decisions as a plain list to paste into an Orbit ticket yourself
// (GET /api/jobs/:slug/decisions.md, its `orbit` part, dashboard/lib/decisions.js). It opens a small
// panel with the text exactly as it will be copied and one Copy button that says Copied for two
// seconds. Starbase only puts it on your clipboard; it never sends anything to Orbit.
// Read when the panel opens, so it has the decisions made since.
import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/Button';
import { Sheet } from '../components/Sheet';
import { BRAND } from '../app/brand';
import { useWorkshop } from '../state/store';

interface OrbitList { text: string; count: number }

export function CopyDecisions({ slug }: { slug: string }) {
  const { api } = useWorkshop();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<OrbitList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setList(null);
    setError(null);
    setState('idle');
    api.get<{ orbit?: OrbitList }>(`/api/jobs/${encodeURIComponent(slug)}/decisions.md`)
      .then((r) => {
        if (!live) return;
        if (typeof r?.orbit?.text !== 'string') setError(`${BRAND.name}’s answer had no list in it`);
        else setList(r.orbit);
      })
      .catch((err) => { if (live) setError(err instanceof Error ? err.message : String(err)); });
    return () => { live = false; };
  }, [api, slug, open]);

  async function copy() {
    if (!list) return;
    try {
      await navigator.clipboard.writeText(list.text);
      setState('copied');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setState('idle'), 2000);
    } catch {
      setState('failed');
    }
  }

  return (
    <>
      <Button kind="quiet" size="sm" icon="copy" onClick={() => setOpen(true)} title="Copy the product decisions as a plain list, to paste into the Orbit ticket.">Copy decisions</Button>
      {open && (
        <Sheet title="Copy decisions" onClose={() => setOpen(false)}>
          <p className="muted">This is exactly what will be copied. {BRAND.name} does not send it anywhere.</p>
          {list && <pre className="copy-decisions-text" aria-label="The text that will be copied">{list.text}</pre>}
          {!list && !error && <p className="muted">Reading the decisions…</p>}
          {error && <p className="field-problem" role="alert">Couldn’t read the decisions: {error}</p>}
          {state === 'failed' && <p className="field-problem" role="alert">Couldn’t copy: this browser didn’t allow it. Select the text above and copy it yourself.</p>}
          <div className="sheet-actions">
            <Button kind="quiet" onClick={() => setOpen(false)}>Close</Button>
            <Button kind="primary" disabled={!list} onClick={() => void copy()}>{state === 'copied' ? 'Copied' : 'Copy'}</Button>
          </div>
        </Sheet>
      )}
    </>
  );
}
