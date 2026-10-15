// The folded "How this works" box each pane carries for teammates new to the tool. Open until you
// close it; whether it's open is remembered per pane in this browser (localStorage).
import { useState, type ReactNode } from 'react';

const key = (id: string) => `fw.how.${id}`;

function readOpen(id: string): boolean {
  try { return localStorage.getItem(key(id)) !== 'closed'; } catch { return true; }
}

export function HowThisWorks({ id, children }: { id: string; children: ReactNode }) {
  const [open, setOpen] = useState(() => readOpen(id));
  return (
    <details
      className="how"
      open={open}
      onToggle={(e) => {
        const now = (e.currentTarget as HTMLDetailsElement).open;
        if (now === open) return;
        setOpen(now);
        try { localStorage.setItem(key(id), now ? 'open' : 'closed'); } catch { /* storage off: just don't remember */ }
      }}
    >
      <summary title={open ? 'Hide this explanation. You can open it again any time.' : 'Show a short explanation of this pane.'}>How this works</summary>
      <div className="how-body">{children}</div>
    </details>
  );
}
