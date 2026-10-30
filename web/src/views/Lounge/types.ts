// What GET /api/lounge answers (hosted/site/routes-lounge.js, packet 2D): per person, very little.

export type Presence = 'online' | 'away' | 'off';

/** A job running on someone's laptop. slug: only on your own, so it opens; nobody else's does. */
export interface LoungeJob { ticket: string | null; title: string; stage: string | null; slug?: string }

export interface LoungePerson {
  id: number;
  /** From Google; '' when the account has none. */
  name: string;
  you: boolean;
  presence: Presence;
  lastActiveAt: string | null;
  jobs: LoungeJob[];
}

export interface LoungeAnswer { activeMinutes: number; people: LoungePerson[] }
