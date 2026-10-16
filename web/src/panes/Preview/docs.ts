// The Docs tab's groups and the small facts it shows about each document.
import type { DocGroup, JobDocEntry } from '../../api/types';

export const DOC_GROUPS: { id: DocGroup; label: string; hint: string }[] = [
  { id: 'plan', label: 'Plan & spec', hint: 'The product spec, the findings, and the plans the crew works from.' },
  { id: 'briefs', label: 'Briefs', hint: 'The Foreman’s briefs to you, newest first.' },
  { id: 'review', label: 'Review', hint: 'The reviewers’ findings, the test report and Fable’s second looks.' },
  { id: 'notes', label: 'Notes', hint: 'Your notes for the Foreman and the job’s own records.' },
  { id: 'other', label: 'Other', hint: 'Every other document in the job’s folder.' },
];

/** The documents in DOC_GROUPS order, each group in the dashboard's order; empty groups left out. */
export function groupDocs(docs: JobDocEntry[]): { id: DocGroup; label: string; hint: string; docs: JobDocEntry[] }[] {
  return DOC_GROUPS
    .map((g) => ({ ...g, docs: docs.filter((d) => (DOC_GROUPS.some((x) => x.id === d.group) ? d.group : 'other') === g.id) }))
    .filter((g) => g.docs.length > 0);
}

/** "v2" for a version the records name ("v0.3" for a spec), nothing when unknown. */
export function versionLabel(version: string | null | undefined): string {
  if (!version) return '';
  return /^v/i.test(version) ? version : `v${version}`;
}

/** The size in words a person reads: "840 bytes", "12 KB". */
export function sizeLabel(bytes: number | null | undefined): string {
  if (!Number.isFinite(bytes ?? NaN)) return '';
  const b = Number(bytes);
  return b < 1024 ? `${b} bytes` : `${Math.round(b / 1024)} KB`;
}
