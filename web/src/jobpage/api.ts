// The new job page's two reads (dashboard/site/routes-job-page.js), through the app's own client,
// so the laptop and the website ask the same way (plain GETs; the website's session cookie rides
// along with credentials: 'same-origin').

import type { ApiClient } from '../api/client';
import type { JobBody, JobPagePayload, SamePage } from './types';

export interface JobApi {
  /** The payload, or { same: true, v } when v is the current one. v null: the first ask. */
  page(slug: string, v: number | null): Promise<JobPagePayload | SamePage>;
  /** One body by its id. */
  item(slug: string, id: string): Promise<JobBody>;
}

const jobPath = (slug: string) => `/api/job/${encodeURIComponent(slug)}`;

export function jobApi(client: ApiClient): JobApi {
  return {
    page: (slug, v) => client.get(`${jobPath(slug)}/page${v === null ? '' : `?v=${v}`}`),
    item: (slug, id) => client.get(`${jobPath(slug)}/item?id=${encodeURIComponent(id)}`),
  };
}

export const isSame = (a: JobPagePayload | SamePage): a is SamePage => (a as SamePage).same === true;
