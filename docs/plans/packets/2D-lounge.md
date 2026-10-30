# Packet 2D · The Lounge

**Goal.** Decision G13: one shared page on the site where the team sees, per person, very little:
- whether they're online;
- every ticket and job running on their laptops, with its stage;
- when they were last active.

Nothing more, to avoid surveillance.

**Port 4513 · worktree `../ground-control-2D` · branch `packet/2D-lounge`.** Base: `main` after 2B and 2C are merged. It runs beside 2E.

## The page
- **One row or card per person:**
  - their name, from Google;
  - online, away or off, in words with an icon, never colour alone;
  - their running jobs, each with its ticket key, title and stage;
  - "Last active 12m ago".
- **Never shown:** briefs, conversations, costs, decisions, file names or anything a job's page has.
- **In Play full,** each person is a console tile, as G33 describes, with a quiet working light. Off and subtle follow R's rules.
- **Everyone signed in sees the same Lounge,** with the same fields for every role. A manager sees nothing extra.
- **Clicking your own job** opens it. Another person's job is not a link.

## Checks
- A test that the Lounge API returns only those fields, plus a test listing every field it returns, so an addition fails until it is decided on.
- Shots at 1512 and 390 px, in Light and Default, with Play full and off, of three made-up people: one online with two jobs, one away, one off.

## Owns
- `hosted/site/routes-lounge.js`;
- `web/src/views/Lounge/`;
- its router line and nav entry (hosted mode only).

## Rules
The same as `2A-site-service.md`'s rules section, with this packet's own worktree, branch and port 4513.
