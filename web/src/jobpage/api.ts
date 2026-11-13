// The new job page's two reads (dashboard/site/routes-job-page.js), through the app's own client,
// so the laptop and the website ask the same way (plain GETs; the website's session cookie rides
// along with credentials: 'same-origin').

import type { ApiClient } from '../api/client';
import type { JobBody, JobPagePayload, SamePage } from './types';

export interface JobApi {
  /** The payload, or { same: true, v } when v is the current one. v null: the first ask. */
  page(slug: string, v: number | null, viewer?: string | null): Promise<JobPagePayload | SamePage>;
  /** One body by its id. */
  item(slug: string, id: string, viewer?: string | null): Promise<JobBody>;
}

const jobPath = (slug: string) => `/api/job/${encodeURIComponent(slug)}`;
/** The query, without the empty parts. viewer: the id of the laptop stream the page listens on
 *  (state/live.ts liveViewer), so the runner knows this job is open and rebuilds it at once. */
const query = (parts: Record<string, string | number | null | undefined>) => {
  const q = Object.entries(parts).filter(([, x]) => x !== null && x !== undefined && x !== '')
    .map(([k, x]) => `${k}=${encodeURIComponent(String(x))}`).join('&');
  return q ? `?${q}` : '';
};

export function jobApi(client: ApiClient): JobApi {
  return {
    page: (slug, v, viewer) => client.get(`${jobPath(slug)}/page${query({ v, viewer })}`),
    item: (slug, id, viewer) => client.get(`${jobPath(slug)}/item${query({ id, viewer })}`),
  };
}

export const isSame = (a: JobPagePayload | SamePage): a is SamePage => (a as SamePage).same === true;
