// What the hosted pages share.
import { ApiError, type ApiClient } from '../../api/client';
import type { HostedPerson } from './types';

/** What every hosted page gets: the API, who is signed in, and what to do when the session has ended. */
export interface HostedProps { api: ApiClient; onSignedOut: () => void; person: HostedPerson }

/** A 401: the session ended (signed out elsewhere, removed, or 30 days unused). */
export const isSignedOut = (err: unknown) => err instanceof ApiError && err.status === 401;
export const words = (err: unknown) => (err instanceof Error ? err.message : String(err));
