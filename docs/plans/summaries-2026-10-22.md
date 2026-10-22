# Key points: a short summary of every brief and document (2026-10-22)

The ask: "a summary of the brief with most important points that I need to know for any stage that
the AI worked on, so that I don't have to read entire long briefs." For both the briefs in the
conversation and the documents in the Docs tab.

## Decided with the user

- **What:** both. Each document (spec, findings, plan, test plan, reviews, …) gets a **Key points**
  box at the top in the Docs tab; each brief gets an **In short** box above the whole brief.
- **What a summary says**, in four labelled parts, each at most 3 lines of ~140 characters, empty
  parts left out: *Outcome* · *Risks and surprises* · *Decisions for you* (each with the
  recommendation) · *What changed* (only from a second version on).
- **Who writes it:** the Foreman (the conductor), from the file on disk, before every brief. The
  dashboard never calls a model; it only reads and shows.
- **Where:** one small JSON file per document and version, in the job folder's `summaries/`
  (not one `summaries.json`: rewriting a whole file each brief costs tokens as the job grows, one
  bad write would lose every summary, two writers could clobber each other, and history per
  version comes free). Approved documents are never edited for this.
- **Old jobs:** where a document has no summary, a **Summarise** button puts a request into the
  job's message box; you send it like any message (Send… shows exactly what goes), the Foreman
  writes the files. Nothing runs until you send.

## The file

`<job>/summaries/<file without .md/.json>[.v<version>].json`, e.g. `summaries/findings.v1.json`,
`summaries/briefs/006-review.json` (briefs have no version), `summaries/spec.v0.3.json` (the
product spec, which lives in the repository, is `spec`).

```json
{
  "schema_version": 1,
  "file": "findings.md",
  "version": "1",
  "written": "2026-10-22T10:40:00-07:00",
  "outcome": ["…"],
  "risks": ["…"],
  "decisions": [{ "text": "…", "recommendation": "…" }],
  "changed": ["…"]
}
```

## The dashboard

- `lib/docs.js` `readSummary(dir, file, version)`: the summary whose version matches, else the
  newest one (marked stale, with its version), else null. Malformed files and fields are dropped;
  lines are trimmed and capped. `listJobDocs` marks each entry `summary: 'current' | 'stale' | null`.
- `GET /api/job/:slug/doc` carries `summary` (null when none).
- Web: `components/KeyPoints.tsx` draws the box (word labels, theme tokens, a `<section>` with a
  heading). The Docs reader shows it above the page; the brief card shows it above the brief, with
  the brief itself under "Read the whole brief". No summary → the Summarise button (adds a request
  between marker lines in the draft, like the Screens feedback); a stale one says which version it
  describes. The doc list marks documents that have one.
- Demo: summaries for the demo jobs' documents and briefs, one of them stale, one missing.

## The workflow (skill repo, claude-feature-workflow)

- `skills/feature/status-json.md` §3: the summaries folder and format.
- `skills/feature/brief.md`: before each brief, write the summary of each document the stage
  produced or changed, and one of the brief itself.
- `skills/feature/SKILL.md`: a "Write the missing summaries" message means: write them, from the
  files on disk, and reply in one line.

## Tests

Server: readSummary (match, stale, none, malformed, caps, no path escape), the list mark, the /doc
field. Web: KeyPoints rendering (parts, empty parts, stale note, the Summarise button and its draft
block), the brief card and the Docs reader with and without one. All 11 themes looked at.
