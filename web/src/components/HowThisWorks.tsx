// The folded "How this works" box each pane, card and drawer carries for teammates new to the tool.
// Folded until you open it (defaultOpen true starts it open instead); whether you left it open or
// closed is remembered per box in this browser (localStorage), so a box you opened stays open.
import { useState, type ReactNode } from 'react';

const key = (id: string) => `fw.how.${id}`;

function readOpen(id: string, defaultOpen: boolean): boolean {
  try {
    const v = localStorage.getItem(key(id));
    return v === null ? defaultOpen : v !== 'closed';
  } catch { return defaultOpen; }
}

export function HowThisWorks({ id, children, defaultOpen = false }: { id: string; children: ReactNode; defaultOpen?: boolean }) {
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
      <summary title={open ? 'Hide this explanation. You can open it again any time.' : 'Show a short explanation of what this is and how it works.'}>How this works</summary>
      <div className="how-body">{children}</div>
    </details>
  );
}
