# Claude API & Email Drafting Engine

---

## Prompt caching architecture

Every Claude API call that sends product context (Edge Collateral proof points, Metabase stats, cadence rules, stage descriptions) must use `cache_control: {type: "ephemeral"}` on the system prompt block. This avoids re-tokenizing the large product context on every call.

Structure all requests as:
```json
{
  "model": "claude-opus-4-6",
  "system": [
    {
      "type": "text",
      "text": "<large product context block — Edge Collateral, Metabase stats, stage descriptions, tone guidelines>",
      "cache_control": { "type": "ephemeral" }
    }
  ],
  "messages": [
    {
      "role": "user",
      "content": "<per-contact personalization context — name, title, company, opp stage, prior touches, Gong summary if applicable>"
    }
  ]
}
```

The system prompt block is the same across all reps; the user message varies per contact. This maximizes cache hit rate.

Invoke the `claude-api` skill whenever touching code that imports `anthropic`. It enforces correct prompt caching and SDK usage.

---

## Standard draft generation

**Inputs per contact:**
- Contact: name, title, company
- Opportunity: stage, prior `next_steps`, description notes from SF
- Prior activity: last activity date/type, number of prior touches, any reply history
- Edge Collateral proof points (in cached system prompt)
- Metabase category stats (e.g., "2,500+ tagged manufacturers in Drink Powder") — in cached system prompt

**Output:** 2–3 copy variants with different angles:
- **Social proof:** lead with a customer success story (e.g., House Autry 40% open rate, Cheryl's Herbs 250 email captures)
- **Data:** lead with a category-specific number from Metabase
- **Pain point:** lead with the problem the contact's stage implies they have

Store the selected/drafted copy in `activity_log.draft_copy` when a Gmail draft is created.

---

## Research-enhanced drafts (rep-initiated)

When a rep clicks "Enhance with Research":

1. Frontend calls an Edge Function with: contact name, title, company, current opp context, existing draft copy
2. Edge Function calls Claude API with the `web_search` tool enabled
3. Claude searches for: recent company news/funding/leadership changes, industry trends, contact's public activity, competitor moves
4. Claude rewrites the draft, weaving in 1–2 specific timely references while preserving the original angle (social proof / data / pain point)
5. Enhanced draft replaces the original in Gmail drafts (or is shown side-by-side for the rep to choose)

**Implementation constraints:**
- Rate limit: max 20 research-enhanced drafts per rep per day
- Cache research results per company domain for 24 hours — store the snippet in `activity_log.notes`. If two reps contact the same company within 24 hours, reuse the cached snippet
- Use Anthropic's built-in `web_search` tool; no third-party search API needed

---

## Auto-follow-up drafts (system-triggered)

Triggered automatically when:
- A Gong call summary email is detected for an opportunity where `cadence_rules.auto_followup_on_meeting = true`
- A calendar meeting is detected for the same condition

The system prompt includes: the Gong summary (if available), the meeting context, stage-appropriate tone guidance, and the rep's relationship history with the contact.

The resulting draft is created directly as a Gmail draft via the `gmail.compose` scope, with relevant collateral attached.

---

## Collateral

The Edge Collateral PDF (`2026 Edge Collateral.pdf`) is the primary attachment for outbound drafts. Attach it as a Gmail attachment when creating drafts via the Gmail API. The PDF is at:

`/Users/alexgold-keychain/Documents/Claude/Projects/Keychain Outreach Tool/2026 Edge Collateral.pdf`

It should be stored in a location accessible to Edge Functions (e.g., Supabase Storage) rather than referenced by local path in production.

---

## Trigger-based drafting summary

| Signal | Draft type |
|--------|-----------|
| Contact overdue by 2× cadence threshold | Escalated follow-up (more urgent tone) |
| Stage progression detected (e.g., intro → meeting) | Value-add between-meeting touchpoint |
| Meeting completed, proposal not yet sent | ROI-focused email or case study |
| Reply received from contact | Suggested response |
| New contact added via CSV | Initial outreach with stage-appropriate messaging |
| Meeting scheduled, no prep email sent | Pre-meeting prep email |
| Rep clicks "Enhance with Research" | Research-rewritten version of existing draft |
