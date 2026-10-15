// The exact message the Foreman receives, built by the dashboard's own composeReply
// (dashboard/lib/compose.js, the same file the classic page loads as /shared/compose.js), so both
// views always send the same words. Vite bundles it into the new UI.
import { composeReply, type ComposeStatus } from '../../../dashboard/lib/compose.js';

export type { ComposeStatus };

// composeReply only fills in fields that are missing, not ones the dashboard sent as null.
function clean(status: ComposeStatus | null | undefined): ComposeStatus {
  if (!status) return {};
  return Object.fromEntries(Object.entries(status).filter(([, v]) => v !== null && v !== undefined)) as ComposeStatus;
}

/** Your message, exactly as the Foreman will receive it. */
export function composeMessage(note: string, status?: ComposeStatus | null): string {
  return composeReply({ kind: 'message', status: clean(status), note });
}
