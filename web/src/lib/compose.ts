// The exact message the Foreman receives, built by the dashboard's own composeReply
// (dashboard/lib/compose.js, the same file the classic page loads as /shared/compose.js), so both
// views always send the same words. Vite bundles it into the new UI.
import {
  composeReply, cleanChips,
  type ComposeAnswers, type ComposeKind, type ComposeStatus, type ComposeVerdicts, type GateChip,
} from '../../../dashboard/lib/compose.js';

export type { ComposeAnswers, ComposeStatus, ComposeVerdicts, GateChip };
/** What a reply from the gate card does: approve, ask for changes, other guidance, or stop. */
export type GateKind = ComposeKind;

// composeReply only fills in fields that are missing, not ones the dashboard sent as null.
function clean(status: ComposeStatus | null | undefined): ComposeStatus {
  if (!status) return {};
  return Object.fromEntries(Object.entries(status).filter(([, v]) => v !== null && v !== undefined)) as ComposeStatus;
}

/** Your message, exactly as the Foreman will receive it. */
export function composeMessage(note: string, status?: ComposeStatus | null): string {
  return composeReply({ kind: 'message', status: clean(status), note });
}

export interface GateReply {
  kind: GateKind;
  answers?: ComposeAnswers;
  verdicts?: ComposeVerdicts;
  note?: string;
  chips?: GateChip[];
}

/**
 * A gate card's reply, exactly as the Foreman will receive it: answers, verdicts on the decisions
 * made on your behalf, one line per next-step chip, then the approval (with "At these versions"),
 * the changes asked for, the guidance or the stop. The dashboard composes the same text when it
 * sends (POST /api/job/:slug/gate), from the job's records at that moment.
 */
export function composeGate(reply: GateReply, status?: ComposeStatus | null): string {
  return composeReply({ kind: reply.kind, status: clean(status), answers: reply.answers ?? {}, verdicts: reply.verdicts ?? {}, note: reply.note ?? '', chips: reply.chips ?? [] });
}

/** The chips that will be sent: malformed ones and repeats left out, one level change at most, at most 8. */
export function gateChips(chips: unknown): GateChip[] {
  return cleanChips(chips);
}
