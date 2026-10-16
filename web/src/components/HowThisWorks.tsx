// The folded "How this works" box each pane carries for teammates new to the tool. Open until you
// close it (or folded until you open it, for a card's box: defaultOpen false); whether it's open
// is remembered per box in this browser (localStorage).
import { useState, type ReactNode } from 'react';

const key = (id: string) => `fw.how.${id}`;

function readOpen(id: string, defaultOpen: boolean): boolean {
  try {
    const v = localStorage.getItem(key(id));
    return v === null ? defaultOpen : v !== 'closed';
  } catch { return defaultOpen; }
}

export function HowThisWorks({ id, children, defaultOpen = true }: { id: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(() => readOpen(id, defaultOpen));
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
