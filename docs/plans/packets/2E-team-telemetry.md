# Packet 2E · Team Telemetry

**Goal.** Decision G30's v2 half, with P's and U's rules. The people who share one Claude account see one shared picture of that account's limit: who used how much, and what's left. Each person's own job graphs stay private.

**Port 4515 · worktree `../ground-control-2E` · branch `packet/2E-team-telemetry`.** Base: `main` after 2B and 2C are merged. It runs beside 2D.

## What crosses
- Each runner sends up its usage lines (`usage.jsonl`, one per turn) as numbers only:
  - time, person, job slug, stage, model, tokens by kind, cost and both plan meters;
  - plus U's "Claude Code outside the app, by name": numbers only, never text, prompts or file names.
- The site checks this again and refuses any line with a text field it doesn't expect.

## The team page (hosted only)
The three graphs about the shared account, common to everyone including the manager:
- **The shared gauge over time, with the forecast,** combined across everyone on the account.
  - The week starts Wednesday 16:00 local.
  - The forecast uses every person's use.
- **Share by model.**
- **"Who used this week's limit":**
  - each person's app use and their Claude Code use outside the app, kept apart;
  - Other use (claude.ai, the Claude app and other people, estimated from the meters), shown once for the account, not per person;
  - for the whole limit, the parts add up to the total, labelled so it's clear who used what. This is P's "two numbers, one total".

The two graphs about a person's own jobs (usage by day by job, cost per ticket and stage) stay private to that person, on the site as on the laptop.

## Checks
- Tests:
  - combining two people's lines;
  - the week boundary;
  - the forecast;
  - Other use never negative;
  - private graphs refused for another person (404);
  - text fields refused.
- Shots at 1512 and 390 px, in Light and Default, with two made-up people and some Other use.

## Owns
- `hosted/site/routes-telemetry.js` and its lib;
- the runner's usage upload in `dashboard/runner/site-link.js` (usage events only);
- web hosted-mode parts of `web/src/views/Telemetry/`.

## Rules
The same as `2A-site-service.md`'s rules section, with this packet's own worktree, branch and port 4515.
