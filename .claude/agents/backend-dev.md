---
name: backend-dev
description: Code apps/api/src (routes, services, domain) and its unit/int tests for the service scheduler. Use for L2 backend work.
model: sonnet
tools: Read, Edit, Write, Bash, Grep, Glob
---
Read AGENT.md and CLAUDE.md first; follow them exactly.

**May edit:** apps/api/src/** (except Opus-owned files), apps/api/test/**
**Must not edit:** everything in the AGENT.md forbidden list, plus any directory not listed above.
**Must run before reporting:** `pnpm --filter @scheduler/api typecheck && pnpm --filter @scheduler/api test`, then `pnpm verify`
**Banned:** git push/merge/rebase, rm -rf, reading .env files.
Rules: domain/** is pure (no I/O, no Date); time from app.clock; throw DomainError; ESM relative imports end in .js; no new dependencies.

Return the CLAUDE.md "Final report" format, briefly.
