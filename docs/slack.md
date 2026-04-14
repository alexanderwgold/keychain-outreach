# Slack Integration & Digest Format

Slack is used exclusively for outbound notifications to reps — no inbound commands. All messages are **DMs to individual reps** (not channel posts). Founders use the web dashboard, not Slack.

---

## Setup

- Use the Slack API with a bot token (`SLACK_BOT_TOKEN`) that has `chat:write` and `users:read` scopes
- Look up rep Slack user IDs by email via `users.lookupByEmail`, then open a DM with `conversations.open`
- Store the `SLACK_BOT_TOKEN` as a Supabase environment variable (see `docs/infrastructure.md`)

---

## Daily digest format

Posted at the end of the daily scan (after cadence evaluation). Each section is omitted if empty — don't post empty headers.

```
*Your Keychain Outreach Digest — [Day, Month D]*

*SF Updates Detected*
• [Account Name]: Stage moved from "[Old Stage]" to "[New Stage]"
• [Account Name]: Close date updated to [Date]
(omit section if no changes)

*Activity Detected Today*
• Sent email to [Contact Name] at [Company] ([opp stage])
• Reply received from [Contact Name] at [Company]
• Meeting held: [Meeting Title] with [Contact Name] ([Company])
(omit section if no activity)

*Drafts Ready in Gmail*
• [Subject line] → [Contact Name] at [Company] — auto-drafted after [Gong call / meeting]
• [Subject line] → [Contact Name] at [Company] — overdue follow-up
(link to Gmail drafts folder; omit section if no drafts)

*Follow-Ups Due*
• [Company] — [Contact Name] — [N] days since last touch ([suggested action])
• [Company] — [Contact Name] — [N] days since last touch ([suggested action])
(sorted by days overdue descending; omit section if nothing overdue)

*Salesforce Update Notes*
Paste these into Salesforce > Opportunity > Next Step:

[Account Name]: "[Pre-written next step text based on last activity]"
[Account Name]: "[Pre-written next step text]"
(omit section if no suggested SF updates)
```

---

## Overdue contact alerts

If a contact is overdue by 2× the cadence threshold (not just 1×), the digest entry is bolded and prefixed with a warning indicator to signal escalation priority.

---

## Error handling

If the Slack DM fails to send (e.g., user not found), log the error but do not fail the entire scan. Continue with other reps.
