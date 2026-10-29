# Ground Control screens, review 1 (2026-10-28): Vignesh's notes and what they decide

Source: the `notes` collection on https://claude.ai/artifact/VWS7nxyvPvG9ruyxszEufF. The Stack page had no notes.

| Section | Verdict / pick | His note (short) | Decision |
|---|---|---|---|
| s-inbox | Looks good | Orbit has no priority any more, only severity. | Drop priority everywhere (row, card, next-step bar, ticket page). Rows show severity (icon + word) only. "Most urgent" = highest severity, then oldest. |
| s-desk | Looks good | Bring back the grid lines if they suit this screen, else only on Stack. | They suit it: the Desk is the go / no go console. Faint grid in Play full only; none in subtle or off. |
| c-desk | A | A by default, B selectable in Settings. | Desk layout setting: "One at a time" (default) or "Three columns". Lives in Settings → Look. |
| s-jobs | Looks good | Hovering a dot on the path shows the stage name, clean. | Each stop dot has a small tooltip on hover and on keyboard focus: the stop's name and its state in words ("Plan · done", "Tests · waiting for you"). Not a browser title tooltip. |
| c-jobs | A | A by default, B in Settings too. | Jobs layout setting: "Four lanes" (default) or "One list". Settings → Look. |
| s-job | Needs change | Stops clickable; inside a stop see the agents, what each is doing, open any in the terminal (like Try it). Folded conversation is good. Beautiful permission alerts with Allow / Deny. | New screen **Stage** (one stop of a job). Every stop on the Job map opens it. It lists everyone working that stop (the Foreman and each crew member): role, model, what it's doing now in words, how long, status in words, and **Open in terminal** for each. Folded conversation stays. A **permission alert** card at the top of Job and Stage. |
| c-track | A, looks good | Keep the crew, only in Play full: small on each stop circle, bigger when the stop is opened. Keep the crew generic and changeable until the product name is settled. | Crew shows only in Play full: a small face on each stop circle of the Job map, and full-size on the Stage screen. Subtle and off show role words and initials. Crew names and looks come from one swappable crew pack; roles are generic (Planner, Builder, Tester, Reviewer…). The product name comes from one place; "Ground Control" is the working name, not final. |
| s-tele | Needs change | Model, user and stage are fine but want deeper insights to decide product, usage and plans. Up to 10 graphs, each can fold or hide. | Telemetry becomes up to 10 insight graphs (list below), each headed by its finding, with a "what to do" line, a Fold and a Hide. Hidden graphs come back from "Show hidden graphs (n)". Its build moves to a new packet P. |

## Stage screen (new, from s-job)

- Opened by clicking (or Enter on) any stop on the Job map; the address is `#/job/<slug>/stage/<stop>`. Back returns to the Job.
- Header: the stop's name, its state in words, time in it, and the job's one primary action for this stop (as on the Job page).
- **Who's on it**: one row per agent working (or who worked) this stop: the Foreman and each crew member, by generic role. Each row: face (Play full) or initials, role, model, what it's doing now in one plain line ("Running the tests: 212 of 577 passed so far"), time on it, status in words (Working, Waiting for you, Done, Stopped). Done agents fold under "Finished here (n)".
- **Open in terminal** on each row, using the terminal app picked in Try it / Settings:
  - the Foreman: continues the job's own Claude session in the terminal (as today's "Continue in terminal");
  - a crew member: follows its live log in the terminal, read-only (a crew member's run can't be taken over; the Foreman is the one to talk to);
  - and one "Open the job's folder in a terminal".
- The stop's part of the conversation, folded as on the Job page, and the message box (c) at the bottom.
- In Play full each agent is drawn as its crew member, bigger; subtle and off use initials and the role word.

## Permission alert (from s-job)

- A card pinned above the conversation on Job and Stage (and in the Desk queue, as today) when the Foreman asks to do something that needs a yes.
- Says in plain words what it wants to do, the exact command or file underneath (folded when long), why it asked, and what happens on each answer.
- Buttons: **Allow once** and **Deny**; **Always allow for this job** only for the kinds of action the permission setting allows remembering. Hard-line actions (merges, migrations, org or force pushes) never offer "always", and the `a` key never allows them, as today.
- Status in words and an icon (shield), never colour alone. Several waiting: "2 more waiting" under it, oldest first.

## Telemetry: the ten insight graphs (from s-tele)

Each card: a headline that is the finding ("Review costs 31% of your spend, up from 22% last month"), the graph, one "What to do" line, Table ▸ for the numbers, Fold (keeps the headline) and Hide (moves it to "Show hidden graphs"). Fold and hide are remembered per person in the browser. Private (lock) or account-wide (people) as today.

1. **Weekly limit and forecast** (kept): the week's percent with resets, the 5-hour line, "At this pace, full on Thursday 14:00".
2. **Cost per finished ticket, by week**: median and spread for tickets that reached the finish line. Shows whether work is getting cheaper.
3. **Where the spend goes, by stage**: share of cost per stage this month against last month.
4. **Models: share and what a switch would save**: spend by model family, and the saving if the costliest stage used the next model down (from cost.js `whatIfConductor`).
5. **People on the account** (kept): spend and weekly percent per person, no job names.
6. **Rework**: cost spent after a "send back", by stage. High rework in one stage points at its brief or its checks.
7. **Waiting on you**: hours jobs sat in Needs you, per week, and the median time to answer. Shows whether people are the bottleneck.
8. **Time to PR #1, by job size**: days from start to PR #1 per ticket, small against large route.
9. **When the limit goes**: hour of day × weekday heatmap of spend. Helps plan big runs into quiet hours and 5-hour windows.
10. **Cache reuse**: share of input tokens read from cache, by week, with the jobs that reused least. Higher is cheaper.

Data wrangling (packet P): drop demo and test-folder lines (the same isTemp rule as history.js), count each turn once (lines share a `turn` id), fold model ids into families, attribute a resumed session's cost by difference (as usage-log does), mark weeks with no meter reading instead of guessing, and keep outliers in the table but cap them on the graph with a note. Graphs 6–8 join usage lines with the audit log and job status (send-backs, gate waits, PR #1 times).

## Settings → Look (new section, from c-desk and c-jobs)

Desk layout (One at a time / Three columns), Jobs layout (Four lanes / One list), Play (full / subtle / off) and the theme, in one place.
