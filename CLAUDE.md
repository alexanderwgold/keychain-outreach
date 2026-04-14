# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Project purpose

Keychain Outreach Tool is an internal sales automation system for Keychain's 25+ rep team. It surfaces daily contact priorities, auto-drafts personalized outreach emails via Claude API, enforces follow-up cadence, and gives founders real-time visibility into pipeline coverage — all through tools reps already use (Gmail, Google Calendar, Slack).

Full spec: `/Users/alexgold-keychain/Documents/Claude/Projects/Keychain Outreach Tool/Keychain Outreach Tool - Spec.md`

## Goals

1. Every rep knows exactly who to contact each day and what to say.
2. Outreach cadence is enforced automatically — overdue contacts trigger Slack alerts and Gmail drafts.
3. Founders see team-wide activity in real time without manual reporting.
4. Reps spend less than 5 minutes per day interacting with this system.

## Non-goals (v1)

- No live Salesforce API. Data enters via CSV upload and SF report email parsing only.
- No automated email sending. Gmail drafts only — reps always review before sending.
- No A/B testing infrastructure.
- No Chrome extension or desktop app.

---

## Commands

```bash
npm install       # install dependencies
npm run dev       # local dev server
npm run build     # production build
```

---

## Available superpowers — use these

- **Supabase MCP** (`mcp__supabase__*`): inspect schema, run migrations, execute SQL, and manage the database directly without leaving the session. Always verify schema via MCP before assuming table structure.
- **Vercel plugin**: use `/deploy` to build and deploy the frontend. Use Vercel agent skills for project, domain, and environment variable management.
- **`claude-api` skill**: invoke whenever touching code that imports `anthropic` or calls the Claude API. It enforces prompt caching and correct SDK usage automatically.
- **Gmail MCP** (`mcp__claude_ai_Gmail__*`): use for testing inbox scan logic and verifying draft creation during development.
- **Google Calendar MCP** (`mcp__claude_ai_Google_Calendar__*`): use to verify calendar event matching during development.

---

## Coding standards

- **Parallelism in Edge Functions**: all per-rep operations (Gmail scan, calendar check, cadence evaluation) must run in parallel across reps. Never loop sequentially over reps — Edge Functions will timeout.
- **Prompt caching**: every Claude API call that sends product context must use `cache_control: {type: "ephemeral"}` on the system prompt block. See `docs/ai.md` for the caching architecture.
- **Secrets via Supabase Vault**: Google OAuth refresh tokens are stored encrypted via Vault, never in plaintext columns.
- **TypeScript**: strict mode throughout. No `any` types.
- **No speculative abstractions**: build for what the spec requires now, not hypothetical future needs.

---

## Debugging principles

- **Diagnose before fixing.** Read the error fully. Check assumptions about schema (via Supabase MCP), API responses, and environment variables before changing code.
- **One variable at a time.** When something is broken, isolate the failure to one layer (DB query, Edge Function logic, API call, frontend fetch) before touching multiple layers.
- **Don't compound errors.** If an approach isn't working after investigation, stop and surface the blocker — don't stack workarounds on top of a misunderstood root cause.
- **Read the component doc first.** Before modifying any component, read its doc in `docs/`. The doc explains intent and constraints that aren't visible from the code alone.
- **Verify live state.** Schema, environment variables, and deployed function versions may differ from what's in the repo. Use MCP tools and Vercel plugin to check actual state before assuming.

---

## Documentation (read before touching each component)

| Component | Doc |
|---|---|
| Database schema & migrations | `docs/database.md` |
| Edge Functions & cron jobs | `docs/edge-functions.md` |
| Google OAuth & rep token flow | `docs/auth.md` |
| Claude API & email drafting engine | `docs/ai.md` |
| Frontend structure & routes | `docs/frontend.md` |
| Slack integration & digest format | `docs/slack.md` |
| Infrastructure & environment variables | `docs/infrastructure.md` |
| CSV import & Salesforce sync | `docs/salesforce-sync.md` |
