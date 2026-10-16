// What the job menu and ⌘K do to a job, in one place so both behave the same. Each call is one
// dashboard route (dashboard/server.js); the live events that follow bring the page up to date.
import type { ApiClient } from '../api/client';
import type { Closed, GateRequest, GateResult, JobNotes, JobOptions, JobPolicyResult, LevelNumber, OptionsResult, PolicyId, Usage } from '../api/types';
import type { Store } from '../state/store';

const job = (slug: string) => `/api/job/${encodeURIComponent(slug)}`;

/** End the reply in progress (decision D2): the job then waits for your next message. */
export async function stopRun(api: ApiClient, runId: string) {
  await api.post(`/api/runs/${encodeURIComponent(runId)}/stop`, {});
}

/** Put a job marked done or dropped back among the open ones. Nothing else changes. */
export async function reopenJob(api: ApiClient, slug: string) {
  await api.post(`${job(slug)}/reopen`, {});
}

export interface CloseChoice {
  as: 'done' | 'dropped';
  note: string;
  /** Also remove its worktree, only when nothing would be lost (the dashboard checks). */
  removeWorktree: boolean;
}

/** Mark a job done or dropped (the classic view's Mark done options). */
export async function closeJob(api: ApiClient, slug: string, choice: CloseChoice): Promise<Closed | null> {
  const r = await api.post<{ closed?: Closed }>(`${job(slug)}/close`, choice);
  return r?.closed ?? null;
}

/** Set one job's own permission setting (null: it follows your global one), shown at once. */
export async function setJobPolicy(api: ApiClient, store: Store, slug: string, dir: string | null | undefined, policy: PolicyId | null) {
  const r = await api.post<JobPolicyResult>(`${job(slug)}/policy`, { policy });
  const settings = store.getState().meta?.settings;
  if (settings && dir) {
    const jobPolicy = { ...(settings.jobPolicy ?? {}) };
    if (r.policyOverride) jobPolicy[dir] = r.policyOverride; else delete jobPolicy[dir];
    store.dispatch({ type: 'settings', settings: { ...settings, jobPolicy } });
  }
  return r;
}

/**
 * Send a gate card's decision (answers, verdicts, chips, note). The dashboard composes the reply,
 * saves the chips' option changes, and sends it; or, with a reply in progress, sends nothing and
 * returns the text (sent: false); or, asked to start after the usage limit resets, holds it.
 * Refusals (409: limited, terminal, terminal-open, stale-brief; 400: too much) throw an ApiError.
 */
export async function sendGate(api: ApiClient, slug: string, body: GateRequest): Promise<GateResult> {
  return api.post<GateResult>(`${job(slug)}/gate`, body);
}

/**
 * Change a job's level (POST /api/job/:slug/options with the level alone), from the next stage.
 * The dashboard merges it with the job's options as they are on disk (lib/options.js
 * optionsAtLevel, as the gate card's level chip does): the new level brings its own stages,
 * reviewers and Fable points (the defaults the consequence line describes); the documents you
 * provided, your notes and the fix rounds are kept; manual test and the models are kept only where
 * they were the job's own choice, else they follow the new level. The dashboard audits it, and the
 * conversation says "Level changed from L2 Standard to L3 Large".
 */
export async function setJobLevel(api: ApiClient, slug: string, level: LevelNumber): Promise<OptionsResult> {
  return api.post<OptionsResult>(`${job(slug)}/options`, { level });
}

/**
 * Save a job's whole options from the options editor (POST /api/job/:slug/options { options }).
 * The dashboard checks and tidies them (lib/options.js normalize) and answers with the options as
 * saved and the plain lines describing them; a refusal (400, with a plain message) throws an ApiError.
 */
export async function saveJobOptions(api: ApiClient, slug: string, options: JobOptions): Promise<OptionsResult> {
  return api.post<OptionsResult>(`${job(slug)}/options`, { options });
}

/** A job's notes.md (empty text when it has none yet). */
export async function loadJobNotes(api: ApiClient, slug: string): Promise<JobNotes> {
  return api.get<JobNotes>(`${job(slug)}/notes`);
}

/** Replace a job's notes.md (PUT, at most 20,000 characters); answers with the notes as saved. */
export async function saveJobNotes(api: ApiClient, slug: string, text: string): Promise<JobNotes> {
  return api.put<JobNotes>(`${job(slug)}/notes`, { text });
}

/** Carry on now: start the jobs paused by the usage limit again. Returns how many started. */
export async function carryOnNow(api: ApiClient): Promise<number> {
  const r = await api.post<{ resumed?: unknown[] }>('/api/usage/resume', {});
  return Array.isArray(r?.resumed) ? r.resumed.length : 0;
}

/** Turn automatic carry-on (when the limit resets) on or off. */
export async function setAutoCarryOn(api: ApiClient, store: Store, on: boolean) {
  const usage = await api.post<Usage>('/api/usage/auto', { on });
  if (usage && typeof usage === 'object') store.dispatch({ type: 'usage', usage });
}
