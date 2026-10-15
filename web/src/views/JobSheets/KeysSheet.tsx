// The list of keys (?), from app/keys.ts.
import { KEY_LIST } from '../../app/keys';
import { Sheet } from '../../components/Sheet';

export function KeysSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="Keyboard shortcuts" onClose={onClose} className="keys-sheet">
      <dl className="key-list">
        {KEY_LIST.map((k) => (
          <div key={k.keys} className="key-row">
            <dt><kbd className="kbd">{k.keys}</kbd></dt>
            <dd>{k.what}</dd>
          </div>
        ))}
      </dl>
      <p className="muted sheet-fine">Single-letter keys don’t work while you’re typing in a box: click outside it, or press Esc in a menu first. Keys for approving and revising briefs come with gate cards.</p>
      <div className="sheet-actions">
        <button type="button" className="btn" onClick={onClose} title="Close this list (Esc).">Close</button>
      </div>
    </Sheet>
  );
}
