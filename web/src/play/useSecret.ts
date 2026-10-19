// useFindSecret(): tells the play ledger an easter egg was found (POST /api/play/secret). Only with
// Play mode on, and each secret once per page load (the dashboard records it once anyway). It never
// gets in the way: a failed post only means the ledger misses it.
import { useCallback, useContext } from 'react';
import type { ApiClient } from '../api/client';
import { WorkshopContext } from '../state/store';
import type { PageSecret } from './eggs';
import { usePlayIfAny } from './usePlay';

export interface SecretResult {
  recorded: boolean;
  secrets?: { found: string[]; total: number };
}

// Asked already on this page load (its answer, so a second ask gets the same one).
const asked = new Map<PageSecret, Promise<SecretResult | null>>();

/** Tests only: forget what was asked. */
export function forgetSecrets() {
  asked.clear();
}

export function findSecret(api: ApiClient, id: PageSecret): Promise<SecretResult | null> {
  let p = asked.get(id);
  if (!p) {
    p = Promise.resolve()
      .then(() => api.post<SecretResult>('/api/play/secret', { id }))
      .catch(() => { asked.delete(id); return null; });
    asked.set(id, p);
  }
  return p;
}

/** find(id): record a secret (null back with Play Off, outside a WorkshopContext, or when the post failed). */
export function useFindSecret(): (id: PageSecret) => Promise<SecretResult | null> {
  const w = useContext(WorkshopContext);
  const play = usePlayIfAny();
  const on = Boolean(play?.on);
  const api = w?.api ?? null;
  return useCallback((id: PageSecret) => (on && api ? findSecret(api, id) : Promise.resolve(null)), [on, api]);
}
