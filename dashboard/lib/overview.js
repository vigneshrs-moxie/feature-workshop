// The Foreman's overview of a job, in plain words, from what the Foreman itself wrote:
// status.json's `summary` when it keeps one, else its latest brief (the brief format has
// "What happened", "Concerns", "Decisions for you" and "Next"), else the job's own record
// (workflow-status.md's current stage, open items and next step). No guessing, no new text.

import { splitSections, findSection, parseBullets, stripInline } from './markdown-tables.js';

const clean = (s) => stripInline(String(s ?? '').replace(/\s+/g, ' ').trim()).replace(/^[-*]\s+/, '').replace(/`/g, '');

// Parse a brief written in the workflow's brief format.
export function parseBrief(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const out = { headline: null, happened: [], concerns: [], decisions: [], next: null };
  let section = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const head = /^\*\*([^*]+?)\*\*(.*)$/.exec(line);
    if (head && !out.headline && !/^(what happened|concerns|decisions for you|next:?)$/i.test(head[1].trim())) {
      out.headline = clean(`${head[1]}${head[2]}`);
      continue;
    }
    if (head && /^next:?$/i.test(head[1].trim())) { out.next = clean(head[2].replace(/^:\s*/, '')); section = null; continue; }
    if (head) {
      const name = head[1].trim().toLowerCase();
      section = name.startsWith('what happened') ? 'happened' : name.startsWith('concerns') ? 'concerns' : name.startsWith('decisions') ? 'decisions' : null;
      continue;
    }
    if (/^#{1,6}\s/.test(line) && !out.headline) { out.headline = clean(line.replace(/^#+\s*/, '')); continue; }
    const item = /^(?:[-*]|\d+[.)])\s+(.*)$/.exec(line);
    if (item && section) out[section].push(clean(item[1]));
    else if (/^reply\s+["“]go["”]/i.test(line)) section = null;
  }
  return out;
}

// From a free-form or standard workflow-status.md.
export function overviewFromRecord(text) {
  const { sections } = splitSections(String(text ?? ''));
  const current = findSection(sections, /^current stage/i);
  const next = findSection(sections, /^next/i);
  const open = findSection(sections, /^open items|^open questions|^blocked/i);
  const firstLines = (s) => (s?.body ?? '').split(/\r?\n/).map(clean).filter(Boolean);
  const standing = firstLines(current).slice(0, 3);
  return {
    headline: standing[0] ?? null,
    happened: standing.slice(1),
    concerns: parseBullets(open?.body).filter((b) => b.depth === 0).map((b) => clean(b.text)).slice(0, 5),
    decisions: [],
    next: firstLines(next)[0] ?? null,
  };
}

/**
 * Build the overview card. Inputs: status (parsed status.json or null), briefText, recordText,
 * questions, decided, plus facts the dashboard knows (headsUp[]).
 */
export function buildOverview({ status, briefText, briefAt, recordText, recordAt, questions = [], decided = [], headsUp = [] }) {
  let source = null;
  let o = null;
  let at = null;
  if (status?.summary && (status.summary.headline || status.summary.now)) {
    const s = status.summary;
    o = { headline: s.headline ?? s.now, happened: [s.now, ...(s.done ?? [])].filter(Boolean), concerns: s.risks ?? s.concerns ?? [], decisions: s.needs ?? [], next: s.next ?? status.nextProposed ?? null };
    source = 'summary';
    at = status.updatedAt;
  } else if (briefText) {
    o = parseBrief(briefText);
    source = 'brief';
    at = briefAt;
  } else if (recordText) {
    o = overviewFromRecord(recordText);
    source = 'record';
    at = recordAt;
  }
  if (!o) o = { headline: null, happened: [], concerns: [], decisions: [], next: null };
  // What the Foreman needs from you: its open questions first, then unconfirmed decisions.
  const needs = [
    ...questions.map((q) => q.text),
    ...decided.filter((d) => !d.confirmed).map((d) => `Confirm or change: ${d.decision}`),
  ];
  return {
    source, at,
    headline: o.headline,
    standing: o.happened.slice(0, 4),
    concerns: o.concerns.slice(0, 4),
    needs: needs.length ? needs.slice(0, 5) : o.decisions.slice(0, 4),
    next: o.next ?? status?.nextProposed ?? null,
    headsUp,
  };
}
