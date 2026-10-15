// The shell's own UI state, shared by the top bar, the job menu, ⌘K and the keyboard keys:
// - which sheet is open (the command palette, New job, Mark done, the keys list), one at a time;
// - the job open in the Foreman pane with what only its detail knows (its reply in progress, its
//   folder and worktree), so ⌘K can offer Stop and Mark done without fetching it again.
// Without a provider (component tests) every call is a harmless no-op.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { PolicyId, Run } from '../api/types';

export type SheetState =
  | { kind: 'palette' }
  | { kind: 'new-job' }
  | { kind: 'close-job'; slug: string; worktree?: string | null }
  | { kind: 'keys' }
  | null;

/** The open job, as its Foreman pane knows it. */
export interface CurrentJob {
  slug: string;
  run: Run | null;
  dir?: string | null;
  worktree?: string | null;
  policyOverride?: PolicyId | null;
}

export interface Ui {
  sheet: SheetState;
  openSheet(sheet: SheetState): void;
  closeSheet(): void;
  current: CurrentJob | null;
  setCurrent(current: CurrentJob | null): void;
}

const noop = () => {};
const NO_UI: Ui = { sheet: null, openSheet: noop, closeSheet: noop, current: null, setCurrent: noop };

const UiContext = createContext<Ui>(NO_UI);

export const useUi = () => useContext(UiContext);

const sameCurrent = (a: CurrentJob | null, b: CurrentJob | null) =>
  a === b || (!!a && !!b && a.slug === b.slug && a.run?.id === b.run?.id && a.run?.status === b.run?.status
    && a.dir === b.dir && a.worktree === b.worktree && a.policyOverride === b.policyOverride);

export function UiProvider({ children, initialSheet = null }: { children: ReactNode; initialSheet?: SheetState }) {
  const [sheet, setSheet] = useState<SheetState>(initialSheet);
  const [current, setCurrentState] = useState<CurrentJob | null>(null);
  const setCurrent = useCallback((c: CurrentJob | null) => setCurrentState((prev) => (sameCurrent(prev, c) ? prev : c)), []);
  const closeSheet = useCallback(() => setSheet(null), []);
  const value = useMemo<Ui>(() => ({ sheet, openSheet: setSheet, closeSheet, current, setCurrent }), [sheet, closeSheet, current, setCurrent]);
  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}
