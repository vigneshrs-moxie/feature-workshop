// <PlayEggs />: the easter eggs that listen to the whole page (play/eggs.ts), mounted once by the
// shell. Draws nothing. With Play mode Off it listens to nothing and leaves the console alone.
//   the Konami code   ↑↑↓↓←→←→BA anywhere outside a text field: records the secret, which unlocks
//                     the CRT Terminal theme; it is picked, and goes on as soon as the ledger
//                     (fetched again now) says it is unlocked
//   the console       crew art and a hint; crew.hello() answers (and is a secret found)
// usePaletteEggs() is what ⌘K's exact phrases do (the palette draws the Locksmith's door itself).
import { useCallback, useEffect } from 'react';
import { writeStored } from '../lib/stored';
import { useWorkshop } from '../state/store';
import { applyTheme, THEME_KEY, themeUnlocks } from '../theme/theme';
import { CONSOLE_ART, CONSOLE_HELLO, isTypingTarget, KONAMI, konamiStep, showScene, type PaletteEgg } from './eggs';
import { usePlay } from './usePlay';
import { usePlayLedger } from './usePlayLedger';
import { useFindSecret } from './useSecret';

type CrewGlobal = { hello: () => string };

export function PlayEggs() {
  const { api } = useWorkshop();
  const play = usePlay();
  const find = useFindSecret();
  const { retry: refetchLedger } = usePlayLedger(false);

  // The Konami code.
  useEffect(() => {
    if (!play.on) return;
    let at = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) { at = 0; return; }
      at = konamiStep(at, e.key);
      if (at < KONAMI.length) return;
      at = 0;
      void find('konami').then((r) => {
        // The ledger has it, so CRT Terminal is unlocked: pick it (the theme goes on once the
        // ledger, fetched again, says so: the dashboard decides, never this page) and count it as tried.
        if (!r?.secrets?.found.includes('konami')) return;
        writeStored(THEME_KEY, 'crt');
        if (themeUnlocks().crt) applyTheme('crt'); // unlocked before: on at once
        else refetchLedger();
        Promise.resolve().then(() => api.post('/api/play/event', { kind: 'theme', id: 'crt' })).catch(() => { /* only the ledger misses it */ });
        showScene('konami');
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [play.on, find, api, refetchLedger]);

  // The console: art once per page load, and crew.hello() while Play is on.
  useEffect(() => {
    if (!play.on) return;
    const w = window as unknown as { crew?: CrewGlobal };
    if (w.crew) return;
    const crew: CrewGlobal = {
      hello: () => {
        void find('console');
        return CONSOLE_HELLO;
      },
    };
    w.crew = crew;
    if (!greeted) {
      greeted = true;
      console.log(CONSOLE_ART);
    }
    return () => { if (w.crew === crew) delete w.crew; };
  }, [play.on, find]);

  return null;
}

let greeted = false;

/** What ⌘K's exact phrases do (Play on): record the secret and play its scene. */
export function usePaletteEggs(): ((egg: PaletteEgg) => void) | undefined {
  const play = usePlay();
  const find = useFindSecret();
  const run = useCallback((egg: PaletteEgg) => {
    void find(egg);
    if (egg !== 'rm-rf') showScene(egg);
  }, [find]);
  return play.on ? run : undefined;
}
