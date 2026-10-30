// Safety checks for requests that change something (send a reply, decide a permission, start a job).
// They must carry the page's secret token, come from this page's own address, and be JSON.
// Other websites open in the browser can't read the token, so they can't press buttons for you.

import { PRODUCT } from './brand.js';

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/** The token's header. The old name still counts, so a page left open across the update keeps working. */
export const TOKEN_HEADER = 'x-starbase-token';
export const OLD_TOKEN_HEADER = 'x-workshop-token';

export function checkWrite(headers, { port, token }) {
  const sent = headers[TOKEN_HEADER] ?? headers[OLD_TOKEN_HEADER];
  if (!token || sent !== token) {
    throw new HttpError(403, `This action must come from the ${PRODUCT} page. Reload the page and try again.`);
  }
  const origin = headers.origin;
  if (origin && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) throw new HttpError(403, 'Wrong origin.');
  if (!String(headers['content-type'] ?? '').startsWith('application/json')) throw new HttpError(415, 'Send JSON.');
}

// Only requests addressed to this machine by name (blocks DNS-rebinding tricks).
export function hostAllowed(hostHeader) {
  const host = String(hostHeader ?? '').replace(/:\d+$/, '');
  return host === '127.0.0.1' || host === 'localhost';
}
