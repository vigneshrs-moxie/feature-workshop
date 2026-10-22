// The Docs tab's groups and the small facts it shows about each document.
import type { DocGroup, JobDocEntry } from '../../api/types';

export const DOC_GROUPS: { id: DocGroup; label: string; hint: string }[] = [
  { id: 'plan', label: 'Plan & spec', hint: 'The product spec, the findings, and the plans the crew works from.' },
  { id: 'screens', label: 'Screens', hint: 'The feature’s screens the Painter drew from the spec (the Screens tab shows the page), and what they hold as data.' },
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

// ---------- The Preview pane's document tabs ----------

/** The Preview pane's document tabs: the plan (and everything else), the briefs, the review. */
export type DocSection = 'plan' | 'briefs' | 'review';

export const sectionOf = (d: Pick<JobDocEntry, 'group'>): DocSection => (d.group === 'briefs' ? 'briefs' : d.group === 'review' ? 'review' : 'plan');

/** The job's own records and raw files: under "More files", out of the way. */
const RECORDS = new Set(['workflow-status.md', 'implementation-log.md', 'history.md']);
export const isTucked = (d: Pick<JobDocEntry, 'file' | 'group' | 'type'>): boolean =>
  d.type === 'json' || d.type === 'html' || RECORDS.has(d.file) || /^review\//.test(d.file) || d.group === 'other';

/** First in the Plan tab: what you hand on to the reviewer. */
const PINNED = ['acceptance.md', 'dev-tests.md'];

/** A tab's documents: the ones shown, in order (the hand-on pair first), and the ones under More files. */
export function sectionDocs(docs: JobDocEntry[], section: DocSection): { shown: JobDocEntry[]; more: JobDocEntry[] } {
  const mine = docs.filter((d) => sectionOf(d) === section);
  const rank = (d: JobDocEntry) => { const i = PINNED.indexOf(d.file); return i < 0 ? PINNED.length : i; };
  const shown = mine.filter((d) => !isTucked(d)).map((d, i) => ({ d, i })).sort((a, b) => rank(a.d) - rank(b.d) || a.i - b.i).map((x) => x.d);
  return { shown, more: mine.filter(isTucked) };
}
