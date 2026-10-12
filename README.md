# Feature Workshop

A local dashboard for the Claude Code **feature workflow** (spec → investigate → plan → implement → test → review). It shows every feature in progress, what each worker agent is doing, the briefs waiting for you, and what it all costs.

> Work in progress. Full setup and usage instructions arrive with the later milestones.

## Start

```sh
npm start
```

Then open http://127.0.0.1:4477. Stop it with Ctrl+C. Set `PORT` to use another port.

The server only listens on `127.0.0.1`, so nothing outside your machine can reach it.

## Requirements

- Node.js 20 or newer
- Claude Code, logged in with your own account
