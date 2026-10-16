// <PlayLedgerProvider>: fetches the play ledger once for the whole page (usePlayLedger reads it
// from here), and tells the theme picker what the ledger has unlocked (the hidden CRT Terminal and
// Gold themes). With Play mode Off nothing is unlocked, so a hidden theme gives way to the default.
import { useEffect, type ReactNode } from 'react';
import { setThemeUnlocks } from '../theme/theme';
import { PlayLedgerContext, useLedgerFetch } from './usePlayLedger';

export function PlayLedgerProvider({ children }: { children: ReactNode }) {
  const ledger = useLedgerFetch(true);
  const { load } = ledger;
  const unlocks = load.state === 'ready' ? load.view.unlocks : load.state === 'off' ? null : undefined;
  const crt = unlocks?.crt === true;
  const gold = unlocks?.gold === true;
  // Loading or a failed fetch: keep what was known; Off or a ledger: say exactly that.
  const known = unlocks !== undefined;
  useEffect(() => {
    if (known) setThemeUnlocks({ crt, gold });
  }, [known, crt, gold]);
  return <PlayLedgerContext.Provider value={ledger}>{children}</PlayLedgerContext.Provider>;
}
