---
# Orbit (the Moxie portal). Ground Control's registry keeps this copy (plan G31): Orbit's own
# repository doesn't carry a ground-control.md yet. Once it does, that one is used instead.
name: Orbit
github: Moxie-Pest-Control-Phoenix/moxie-portal
remotes:
  fork: origin
  org: moxie
base: moxie/main

# A job's folder, branch and worktree. {n} is the ticket's number, {title} its short title.
slug: "orbit-{n}-{title}"
branch: "{kind}/{slug}"
kinds:
  feature: feature
  bug: fix
worktree: "../orbit-{slug}"

# Fork branch, then the same-named org branch, then staging, then main (skills/ship/SKILL.md).
# In the brackets: who reviews and who merges each one (review rounds, lib/review-round.js reads
# them): "<who> reviews it", "<who> reviews and merges it", "<who> merges it", "you may merge it",
# and "@login" after a name for that person's GitHub login.
prRoute:
  - "PR #1: your fork's branch into the same-named branch on moxie (you review and merge it)"
  - "PR #2: the moxie branch into staging (Raj @rajmehta0311 reviews and merges it)"
  - "PR #3: staging into main (the release owner reviews and merges it)"

# Changes here raise the review level to at least the one given (as lib/level-rules.js does today).
riskFloors:
  - path: "**/migrations/**"
    level: 3
    why: database changes
  - path: "**/*auth*/**"
    level: 3
    why: "sign-in, roles or permissions"
  - path: "**/*permission*/**"
    level: 3
    why: "sign-in, roles or permissions"

tryIt:
  app: app
  command: "npm run dev -- -p {port} -H 127.0.0.1"
  ports: 3001-3099
  url: "http://localhost:{port}"

# Copied from your main checkout into the job's worktree when you press Set up.
filesToCopy:
  - from: app/.env.local
    to: app/.env.local
    portKeys:
      - AUTH_URL
      - NEXTAUTH_URL
      - NEXT_PUBLIC_APP_URL
      - APP_URL
      - NEXT_PUBLIC_SITE_URL
      - SITE_URL
    signInSkip: DEV_BYPASS_AUTH

# The shared local database: its address is DATABASE_URL in the copied settings file.
database:
  urlKey: DATABASE_URL
  check: "pg_isready -h localhost"

setup:
  - "cd app && npm install"
  - "cd app && npx prisma generate"
# Stacks: a big ticket split into sections (stack.md). Each section gets its own worktree and
# branch, made from the stack's branch; after each section merges into it, these checks run there.
sectionWorktree: "../orbit-{n}-{section}"
sectionBranch: "{kind}/orbit-{n}-{section}"
checks:
  - "cd app && npm run check"
  - "cd app && npm run build"
# Ground Control removes the worktree itself when you mark the job done and everything is on GitHub.
cleanup:
  - "git worktree remove ../orbit-{slug}"
---

# Orbit

How work is done in Orbit, for Ground Control and for people reading this.

- **Remotes.** `origin` is your fork; `moxie` is the org repository, which is never pushed to. Work
  starts from the latest `moxie/main`.
- **A job from a ticket** is called `orbit-<number>-<short title>`. Its branch is
  `feature/<that name>`, or `fix/<that name>` for a bug, with the same name in the fork and the org.
  Its worktree is the folder `orbit-<that name>` next to your main checkout.
- **Pull requests** go from your fork's branch to the org branch of the same name (PR #1), then to
  `staging` (PR #2), then `staging` to `main` (PR #3). `skills/ship/SKILL.md` has the details.
- **Who reviews and merges.** You review and merge PR #1. Raj reviews PR #2 and merges it; when he
  asks for changes, the fix goes to your fork, then by a follow-up PR #1 onto the moxie branch, and
  he is asked again (`skills/ship/review-rounds.md`). The release owner reviews and merges PR #3.
- **Try it on your computer** runs the app in `app/` on its own port from 3001 to 3099, with
  `app/.env.local` copied from your main checkout, pointed at that port and with sign-in skipped
  (`DEV_BYPASS_AUTH=true`). The app only listens on this computer.
- **A stack** (a big ticket split into sections) gives each section the worktree
  `orbit-<number>-<section>` and the branch `feature/orbit-<number>-<section>`, made from the
  stack's own branch, and a port from the same range. After each section merges into the stack's
  branch, `npm run check` and `npm run build` run in `app/`; a failure undoes that merge.
- **Setup** (run these yourself in a new worktree for now): `npm install` and `npx prisma generate`
  in `app/`. Ground Control doesn't run them by itself yet.
