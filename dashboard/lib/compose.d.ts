// Types for compose.js, so the new UI (web/, TypeScript) can import the very same function the
// classic page uses (/shared/compose.js) instead of a copy.

export interface ComposeQuestion {
  id: string;
  text: string;
  options: { id: string; label: string }[];
}

export interface ComposeStatus {
  questions?: ComposeQuestion[] | null;
  decidedOnYourBehalf?: { id?: string; decision?: string; confirmed?: boolean }[] | null;
  nextProposed?: string | null;
  spec?: { version?: string | number | null; status?: string | null } | null;
  artifacts?: { name: string; version?: string | number | null }[] | null;
  brief?: { number?: number | null } | null;
}

export function composeReply(args: {
  kind: 'approve' | 'changes' | 'stop' | 'message';
  status?: ComposeStatus;
  answers?: Record<string, { choice?: string; other?: string }>;
  verdicts?: Record<string, { verdict: 'confirm' | 'change'; note?: string }>;
  note?: string;
}): string;
