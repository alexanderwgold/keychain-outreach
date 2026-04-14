# Infrastructure & Environment Variables

---

## Services

| Service | Purpose | Notes |
|---------|---------|-------|
| Supabase | Database, Edge Functions, Auth, Vault | Free tier; project ref `hjxaqhbkdvckapsqvqcq` |
| Vercel | Frontend hosting | Linked to this repo |
| Google Cloud | OAuth app, Gmail API, Calendar API | Internal app scoped to @keychain.com |
| Slack | Rep DM notifications | Bot token with `chat:write`, `users:read` |
| Anthropic | Claude API for drafting | Prompt caching required on all product-context calls |

---

## Environment variables

Set as Supabase Edge Function secrets (`mcp__supabase__*` or via Supabase dashboard). Vercel env vars are needed for any values the frontend references.

| Variable | Used by | Description |
|----------|---------|-------------|
| `GOOGLE_CLIENT_ID` | auth-callback, Edge Functions | Google OAuth app client ID |
| `GOOGLE_CLIENT_SECRET` | auth-callback | Google OAuth app client secret |
| `ANTHROPIC_API_KEY` | daily-scan, weekly-meeting-scan | Claude API key |
| `SLACK_BOT_TOKEN` | daily-scan | Slack bot token (`xoxb-...`) |
| `SUPABASE_URL` | Frontend, Edge Functions | Supabase project URL |
| `SUPABASE_ANON_KEY` | Frontend | Public anon key for client-side Supabase JS |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Functions | Service role key for admin DB access in functions |

**Never commit secrets to the repo.** All secrets go in Supabase Vault (for refresh tokens) or Supabase/Vercel environment variable settings (for API keys).

---

## Cron schedules

Set via Supabase's pg_cron or Edge Function scheduler:

| Function | Schedule | Notes |
|----------|----------|-------|
| `daily-scan` | Weekdays, 3:30pm ET | After SF report emails have been delivered (SF reports send to reps at 2pm ET) |
| `weekly-meeting-scan` | Mondays, 8am ET | Early enough for reps to act before the week starts |

---

## Supabase MCP

The `.mcp.json` at the repo root connects Claude Code to the Supabase project:

```json
{
  "mcpServers": {
    "supabase": {
      "type": "http",
      "url": "https://mcp.supabase.com/mcp?project_ref=hjxaqhbkdvckapsqvqcq"
    }
  }
}
```

Use `mcp__supabase__*` tools to inspect tables, run migrations, deploy functions, and check logs without leaving the session.
