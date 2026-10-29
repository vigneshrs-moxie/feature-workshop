// The usage warning banner under the top bar: the plan's 5-hour or weekly usage has reached 80 %,
// 90 % or full (dashboard/lib/usage-warnings.js, sent with planUsage.warnings). The words say it, never
// the colour alone, and the text is the same as the notification's. Each warning can be dismissed;
// the next threshold is a new warning, so it shows again. Nothing is ever stopped from here.
import type { PlanUsage } from '../api/types';
import { useStored } from '../lib/stored';
import { useWorkshopState } from '../state/store';

export type { UsageWarning } from '../api/types';

/** The dismissed warnings' ids, remembered in this browser. */
export const DISMISSED_KEY = 'fw.usage.warnings.dismissed';
const KEEP = 20;

function parse(raw: string | null): string[] {
  try {
    const v: unknown = JSON.parse(raw ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function UsageWarningBanner() {
  const { planUsage } = useWorkshopState();
  const [raw, setRaw] = useStored(DISMISSED_KEY);
  const warnings = ((planUsage as PlanUsage | null)?.warnings ?? []).filter((w) => w && typeof w.text === 'string');
  if (!planUsage?.enabled || !warnings.length) return null;
  const dismissed = parse(raw);
  const shown = warnings.filter((w) => !dismissed.includes(w.id));
  if (!shown.length) return null;

  const dismiss = (id: string) => setRaw(JSON.stringify([...dismissed.filter((d) => d !== id), id].slice(-KEEP)));

  return (
    <>
      {shown.map((w) => (
        <div key={w.id} className="usage-banner usage-warn usage-actions" role="status" aria-label="Usage warning" data-threshold={w.threshold}>
          <span>
            <strong>{w.threshold >= 100 ? 'Usage full:' : 'Usage warning:'}</strong> {w.text}
          </span>
          <button type="button" className="btn btn-quiet" onClick={() => dismiss(w.id)} title={w.threshold === 80 ? 'Hide this warning. The next one, at 90 % or when full, still shows.' : w.threshold === 90 ? 'Hide this warning. The next one, when usage is full, still shows.' : 'Hide this warning until the usage resets.'}>
            Dismiss
          </button>
        </div>
      ))}
    </>
  );
}
