# Redesign phase 1 · Gate review (2026-10-15)

What phase 1 built, how to see it, and what to check before saying yes. Plan: `phase-1-plan-2026-10-15.md`. Design: `redesign-2026-10-14.md` (sections 2, 9, 10, 11).

## How to run it

Demo only: a pretend Foreman answers, the jobs are invented, and it uses no Claude usage.

```sh
npm install                       # once (web/ is an npm workspace)
npm run web:build                 # builds web/ into web/dist
PORT=4479 npm run demo            # dashboard on invented jobs, fake Foreman
```

Then open **http://127.0.0.1:4479/next/**. The classic UI is still at http://127.0.0.1:4479/. Stop the demo with Ctrl+C.

The demo keeps its jobs, rules and settings in a temp folder (`$TMPDIR/feature-workshop-demo`). It never touches `~/.claude` or `~/.feature-workshop`, and it starts fresh each time.

Things to try in the demo:

- **New job** (top bar, or key `c`). The pretend Foreman asks once for `npm run test:db`.
- On that card, choose **Always allow…**, pick a rule, then **Next** and **Save rule and allow**. The rule then shows in **Settings**, where you can remove it.
- Type a message and choose **Send…**. While it replies, type again and choose **Steer**. Your message shows *Queued*, then *Delivered*, then *Acted on*.
- **Stop** ends a reply. The job then waits for you, and your draft is kept.
- In **Settings**, choose **Auto mode** and send again. Three things happen:
  - a dim "⊘ Auto mode blocked" line for a risky download;
  - a `git push` card, because hard lines always ask;
  - no **Always allow…** on that card.
- Write "push" in a message to see the force push to the org repo refused.
- `WORKSHOP_DEMO_NO_AUTO=1` plays an account without auto mode. Auto mode then shows as unavailable, with the reason.

## Demo pass results (step 10)

All of this ran against `PORT=4479` with the fake Foreman. The scripts sat in the session scratchpad and are not committed.

- **HTTP walk:** 61 of 61 checks passed.
  - `/next/` and its hashed assets load with long-cache headers. Deep links fall back to index.html. There is a CSP header and no inline script or style. The classic `/` still works.
  - Every API the new UI calls returns 2xx:
    - `/api/meta`, `/api/snapshot`, `/api/events?v=2`, `/api/repos`, `/api/rules`, `/api/history`, `/api/runs`;
    - `/api/job/:slug`, plus `?before=` and `/doc?file=`;
    - `POST /api/jobs`, `/api/job/:slug/send`, `/api/runs/:id/steer`, `/api/runs/:id/stop`, `/api/permissions/:id`;
    - `POST /api/rules` and `DELETE /api/rules/:id`, `POST /api/settings`, `/api/job/:slug/policy`;
    - `POST /api/job/:slug/close`, `/reopen`, `/api/usage/auto`.
  - The flows behaved as planned:
    - new job, then a card, then allow;
    - send, then steer (*queued → delivered → acted-on*);
    - an Always-allow rule that misses the request is refused; the narrowest rule is saved and allows the request; the next reply asks nothing;
    - Stop leaves no stale cards;
    - global auto mode, a per-job override and clearing it;
    - in auto mode, `git push` still asks and can't be always-allowed, and the blocked line appears in the thread;
    - a live switch during a reply;
    - close and reopen move the job between groups;
    - a stale token gets 403.
  - Every v2 event carries `{v:2,type,seq}`.
- **Browser walk** (headless Chrome, clicking the real UI): 17 of 17 passed, with no console errors and no failed requests. It covered:
  - the shell, the tab-title count, a brief, the New job sheet and ⌘K;
  - a permission card, Always allow (draft, confirm, save);
  - Send with preview, Steer to *Acted on*, and Stop;
  - Settings, switching to auto mode, the hard-line card, Deny, and the blocked line.

Fixed during the pass:

- **The thread now follows new content.** Before, the Foreman pane scrolled to the end only once, on load. New replies, cards and steered messages then arrived below the fold, with the sticky composer over them. Now it stays at the newest item unless you have scrolled up to read. It also goes to the true bottom, so the composer covers nothing. A scroll event that arrives after more content has loaded no longer counts as you scrolling up.
- **Open briefs repeated their headline.** An open brief showed its headline twice: once in the card head, then again as the first line of the body. The body now leaves out that first line when it only repeats the headline. `BriefCard.test.ts` covers this.
- **Nothing shows under the composer.** Thread text showed through in the pane padding below the sticky composer.
- **Routine-steps fold:** "done automatically" and the time ran together ("automaticallyjust now").
- **Favicon:** `/next/` now uses the dashboard's `favicon.svg`. Before, every load logged a 404 for `/favicon.ico`.
- **Demo job titles:** the fake Foreman titled new jobs by their slug ("demo-walk-add-a-…"). It now uses the description you typed (from `options.json`), as the real Foreman does.

## Components

| Component | Purpose | File |
|---|---|---|
| App | The shell: top bar, usage banner, the three panes, sheets, page keys. Owns the store, API client and live sync | `web/src/app/App.tsx` |
| UI state (`UiProvider`) | Which sheet is open, and the open job's details that ⌘K and the job menu need | `web/src/app/ui.tsx` |
| Commands | Every action valid right now, for ⌘K | `web/src/app/commands.ts` |
| Job actions | Stop, Reopen, Mark done, the job's own setting, carry on: one place for the menu and ⌘K | `web/src/app/jobActions.ts` |
| Keys | Page keys from design doc section 2 | `web/src/app/keys.ts` |
| Router | Hash routes: `#/`, `#/job/<slug>`, `#/settings`; classic-view links | `web/src/app/router.ts` |
| API client | GETs; writes with `X-Workshop-Token`, refetch-and-retry once on 403 | `web/src/api/client.ts` |
| Store and reducer | One store, hydrated from `/api/snapshot`, patched by v2 events | `web/src/state/store.ts`, `reducer.ts` |
| Live sync | The v2 event stream, resume from `seq`, resync on reconnect | `web/src/state/live.ts` |
| JobsPane | Jobs grouped Needs you / Running / Paused / Idle / Done; collapses to an icon rail | `web/src/panes/Jobs/JobsPane.tsx` |
| JobRow | Hue dot, title, status glyph and label, stage chip, time | `web/src/panes/Jobs/JobRow.tsx` |
| AlertSettings | Browser notifications and chime switches | `web/src/alerts/AlertSettings.tsx` |
| Alerts | Needs-you count in the tab title, notifications, chime | `web/src/alerts/useAlerts.ts`, `alerts.ts` |
| ForemanPane | The open job's thread (load older, cards, live row), following the newest item; with no job open, every card waiting for you | `web/src/panes/Foreman/ForemanPane.tsx` |
| JobHeader | Title, kind, repo, branch, status, permission setting, the job menu | `web/src/panes/Foreman/JobHeader.tsx` |
| BriefCard | A brief: open while it waits for you, folds to its headline once answered; optional folded detail file | `web/src/panes/Foreman/BriefCard.tsx` |
| ThreadItems | Your messages (with steer states), replies, the routine-steps fold, problems, notes, decisions, dim blocked lines | `web/src/panes/Foreman/ThreadItems.tsx` |
| ExtrasLines | Rulings and proof lines, only when present | `web/src/panes/Foreman/ExtrasLines.tsx` |
| LiveRow | Typing indicator, current step and last text while it replies | `web/src/panes/Foreman/LiveRow.tsx` |
| ServerHtml | Inserts the dashboard's sanitised Markdown HTML | `web/src/panes/Foreman/ServerHtml.tsx` |
| Composer | Send with preview, model, per-job drafts, Steer, Stop | `web/src/panes/Foreman/Composer.tsx` |
| PendingCards | The cards waiting for you, for one job or all jobs | `web/src/components/permissions/PendingCards.tsx` |
| PermissionCard | Allow once, Allow for this reply, Deny… with a note, Always allow… | `web/src/components/permissions/PermissionCard.tsx` |
| QuestionCard | The Foreman's multiple-choice questions, with "Something else" | `web/src/components/permissions/QuestionCard.tsx` |
| AlwaysAllowSheet | Draft, edit and confirm a rule, then save it and allow the request | `web/src/components/permissions/AlwaysAllowSheet.tsx` |
| PreviewPane | Placeholder with classic-view links (D4) until phase 4 | `web/src/panes/Preview/PreviewPane.tsx` |
| SettingsView | Permission setting (ask everything, routine automatic, auto mode) and your Always-allow rules | `web/src/views/Settings/SettingsView.tsx` |
| NewJobSheet | Description, repo, kind, model, optional past conversation | `web/src/views/JobSheets/NewJobSheet.tsx` |
| CloseJobSheet | Mark done or dropped, a note, optionally remove the worktree | `web/src/views/JobSheets/CloseJobSheet.tsx` |
| KeysSheet | The list of keys (`?`) | `web/src/views/JobSheets/KeysSheet.tsx` |
| CommandPalette | ⌘K: a combobox over the commands valid right now | `web/src/components/CommandPalette.tsx` |
| UsageBanner | Usage-limit banner: paused jobs, Carry on now, automatic carry-on, near-limit heads-up | `web/src/components/UsageBanner.tsx` |
| Sheet | Modal sheet: backdrop, focus in and back, Escape | `web/src/components/Sheet.tsx` |
| HowThisWorks | Each pane's folded explainer; remembers whether it's open | `web/src/components/HowThisWorks.tsx` |
| Tokens | The token source and generator; `tokens.css` is generated from it | `web/src/theme/tokens.ts`, `tokens.css` |
| Job hue | Each job's dot colour from its slug | `web/src/theme/hue.ts` |

Backend pieces added for the new UI: `dashboard/lib/web-app.js` (serves `/next`), `lib/events.js` (v2 events), `lib/snapshot.js` (`/api/snapshot` and groups), `lib/rules.js` (Always-allow rules), `lib/hard-lines.js` (hard lines), the steer queue in `lib/driver.js`, and the fake Foreman's Steer and auto mode in `dashboard/demo/fake-query.js`.

## Token sheet (dark theme)

Source: `web/src/theme/tokens.ts`. Colours come from a base hue of 260, an accent hue of 275 and a contrast of 1. The generated copy is `web/src/theme/tokens.css`, and a test fails if it is stale.

**Colour**

| Token | Value | Use |
|---|---|---|
| `--bg-0` | `oklch(.16 .006 260)` | Window, Foreman pane |
| `--bg-1` | `oklch(.19 .006 260)` | Side panes |
| `--bg-2` | `oklch(.22 .006 260)` | Cards |
| `--bg-3` | `oklch(.25 .006 260)` | Raised |
| `--bg-4` | `oklch(.28 .006 260)` | Controls |
| `--border-1` | `oklch(1 0 0 / .06)` | Hairlines |
| `--border-2` | `oklch(1 0 0 / .1)` | Borders |
| `--border-3` | `oklch(1 0 0 / .18)` | Strong borders |
| `--text-1` | `oklch(.95 .004 260)` | Primary text |
| `--text-2` | `oklch(.72 .01 260)` | Secondary text |
| `--text-3` | `oklch(.58 .01 260)` | Hints, times, disabled |
| `--accent` | `oklch(.7 .15 275)` | Accent |
| `--accent-strong` | `oklch(.78 .13 275)` | Accent on hover |
| `--accent-soft` | `oklch(.7 .15 275 / .16)` | Accent backgrounds |
| `--on-accent` | `oklch(.16 .02 275)` | Text on accent |
| `--focus-ring` | `oklch(.78 .13 275)` | Focus rings |
| `--status-ok` / `-bg` | `oklch(.78 .14 155)` / `oklch(.78 .14 155 / .14)` | Done, Acted on |
| `--status-warn` / `-bg` | `oklch(.78 .14 80)` / `oklch(.78 .14 80 / .14)` | Needs you |
| `--status-error` / `-bg` | `oklch(.78 .14 25)` / `oklch(.78 .14 25 / .14)` | Problems, Deny, Stop |
| `--status-info` / `-bg` | `oklch(.78 .14 235)` / `oklch(.78 .14 235 / .14)` | Running |
| `--status-paused` / `-bg` | `oklch(.7 0 0)` / `oklch(.7 0 0 / .12)` | Paused (usage limit) |
| `--job-hue-l` | `.74` | Job dot lightness |
| `--job-hue-c` | `.13` | Job dot chroma |
| `--shadow-1` | `0 1px 2px oklch(0 0 0 / .3), 0 2px 8px oklch(0 0 0 / .2)` | Cards |
| `--shadow-2` | `0 2px 4px oklch(0 0 0 / .3), 0 12px 32px oklch(0 0 0 / .35)` | Sheets |

**Type**

- `--font-sans`: `"Inter", "Inter Variable", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`
- `--font-display`: `"Inter Display", "Inter", "Inter Variable", system-ui, -apple-system, "Segoe UI", sans-serif`
- `--font-mono`: `"Geist Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace` (tabular numbers)
- Sizes: `--text-xs` 11px, `--text-sm` 12px, `--text-base` 13px, `--text-md` 15px, `--text-lg` 20px, `--text-xl` 28px
- `--leading`: 1.45
- Weights: `--weight-regular` 400, `--weight-medium` 500, `--weight-bold` 600

**Spacing (4px grid)**

- `--space-1` 4px, `--space-2` 8px, `--space-3` 12px, `--space-4` 16px
- `--space-5` 20px, `--space-6` 24px, `--space-8` 32px, `--space-10` 40px

**Radius**

- `--radius-sm` 4px, `--radius-md` 6px, `--radius-lg` 10px, `--radius-xl` 14px

**Motion** (transform and opacity only, 300ms at most)

- `--dur-fast` 120ms, `--dur-menu` 180ms, `--dur-pane` 240ms
- `--ease-out`: `cubic-bezier(.16, 1, .3, 1)`
- `--motion-shift` 4px, `--motion-scale-from` .96
- With reduced motion, `--motion-shift` is 0px and `--motion-scale-from` is 1, so only fades remain and pulses stop.

**Layout**

- `--topbar-h` 40px, `--row-h` 32px
- `--jobs-w` 264px (min 240px, max 280px), `--rail-w` 48px
- `--foreman-max` 760px, `--preview-w` 40%

## What to screenshot (dark, 1440×900)

1. **Shell, no job open.** All three panes with their "How this works" boxes, the job groups, and "N need you" in the top bar and tab title.
2. **Shell with the boxes closed.** The everyday look, showing that the closed state is remembered.
3. **A job waiting on a brief:** Widget Export. The brief is open, the question card shows, and decided-on-your-behalf items appear.
4. **A permission card:** a new job with the `npm run test:db` card.
5. **Always allow, step 1:** the draft with Narrowest and the wider, editable choice.
6. **Always allow, step 2:** the confirm read-back.
7. **Send preview:** exactly what the Foreman will receive.
8. **Steer:** a steered message showing *Queued* or *Delivered* while the live row runs, then *Acted on*.
9. **Auto mode:** the dim "⊘ Auto mode blocked" line, plus the `git push` hard-line card without Always allow.
10. **Settings:** the three permission settings and a saved rule. Also run once with `WORKSHOP_DEMO_NO_AUTO=1` to show auto mode unavailable, with the reason.
11. **⌘K:** the palette with a job open.
12. **New job sheet.**
13. **The Jobs pane as the icon rail.**
14. **Keyboard focus:** tab through a card so the focus ring shows.

The browser walk saved rough versions of 1, 3–9, 10 and 11–12. They were taken headless at 2× and are not committed. Take the gate set by hand in a real browser.

## Known gaps

- **Usage limit and the Paused group aren't in the demo.** The fake Foreman never reports a rate limit, so the usage banner, the Paused group and "resumes 3:42pm" weren't seen live. They are covered only by component and reducer tests. Next step: a rate-limit event in `fake-query.js` (for example, when a message says "limit").
- **No font files ship.** Inter and Geist Mono are used if installed; otherwise the system fonts. The CSP is fine either way.
- **Only the final message of a reply shows.** The thread shows each reply's final message. Interim text the Foreman wrote mid-reply only shows in the live row while it runs. One example is the demo's "Noted: …" answer to a steered message. A steered message's *Acted on* badge is the record that it was taken.
- **No automated test for following new content.** jsdom has no layout or ResizeObserver, so the new scroll behaviour was checked only in the browser walk.
- **The "How this works" boxes start open and are long.** The Foreman pane's box pushes the thread down until you close it. That's intended for new teammates, but it is the first thing a regular user will close.
- **Some actions still open the classic UI (D4):** Options, Try it locally, Details, Costs and History search.
- **Not in phase 1:** light theme and fun touches (phase 6), levels and gate cards (phase 2), narrator and usage ring (phase 3), and preview tabs (phase 4).
- **No real job has run in the new UI.** That needs your separate yes.
- **Hard lines ask even when your own message asked for the action.** The list is in `dashboard/lib/hard-lines.js`, with a note to revisit this.
