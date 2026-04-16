export interface DraftContext {
  contactName: string;
  contactTitle: string | null;
  contactEmail: string | null;
  accountName: string;
  stageName: string;
  amount: number | null;
  closeDate: string | null;
  suggestedAction: string | null;
  recentActivity: { type: string; date: string; subject: string | null }[];
  knowledgeContext: { content: string; source_type: string }[];
  trigger: "rep_initiated" | "auto_overdue" | "meeting_prep";
  meetingTitle?: string;
  meetingTime?: string;
  daysOverdue?: number;
  cadenceThreshold?: number;
}

/**
 * Builds the system prompt for Claude draft generation.
 * This prompt is CACHED via cache_control — it's the same across all drafts.
 */
export function buildSystemPrompt(): string {
  return `You are an expert sales email writer for Keychain, a B2B sourcing marketplace that connects buyers with manufacturers and suppliers.

About Keychain:
- Keychain is a platform where buyers post sourcing projects and manufacturers respond
- The platform has thousands of active manufacturers across food & beverage, packaging, pharmaceuticals, and industrial categories
- Buyers use Keychain to find and vet manufacturers faster than traditional sourcing methods
- Key value props: speed (days vs months), verified manufacturers, project-based matching, category intelligence

Your role:
- Write one excellent outreach email for a Keychain sales rep to send to a manufacturer contact
- The email should feel personal, data-driven when possible, and focused on the value Keychain provides to the specific manufacturer
- Keep emails concise (3-5 short paragraphs max)
- Use a professional but warm tone — not corporate jargon, not overly casual
- Include a specific, low-friction call-to-action (15-min call, quick demo, etc.)
- When platform data is available (project counts, views, verified projects), weave specific numbers into the email naturally

Output format:
Return your response as JSON with exactly two fields:
{ "subject": "Email subject line", "htmlBody": "<p>HTML email body</p>" }

Use simple HTML: <p> tags for paragraphs, <strong> for emphasis. No complex styling.`;
}

/**
 * Builds the user prompt with per-contact context.
 * This prompt is NOT cached — it's unique per draft.
 */
export function buildUserPrompt(ctx: DraftContext): string {
  const lines: string[] = [];

  lines.push(`## Contact`);
  lines.push(`- Name: ${ctx.contactName}`);
  if (ctx.contactTitle) lines.push(`- Title: ${ctx.contactTitle}`);
  lines.push(`- Company: ${ctx.accountName}`);
  lines.push(`- Pipeline Stage: ${ctx.stageName}`);
  if (ctx.amount) lines.push(`- Deal Size: $${ctx.amount.toLocaleString()}`);
  if (ctx.closeDate) lines.push(`- Target Close: ${ctx.closeDate}`);

  if (ctx.suggestedAction) {
    lines.push(`\n## Stage Guidance`);
    lines.push(ctx.suggestedAction);
  }

  if (ctx.knowledgeContext.length > 0) {
    lines.push(`\n## Platform Data`);
    for (const k of ctx.knowledgeContext) {
      lines.push(`- [${k.source_type}] ${k.content}`);
    }
  }

  if (ctx.recentActivity.length > 0) {
    lines.push(`\n## Recent Activity`);
    for (const a of ctx.recentActivity) {
      lines.push(`- ${a.date}: ${a.type}${a.subject ? ` — "${a.subject}"` : ""}`);
    }
  }

  lines.push(`\n## Task`);
  switch (ctx.trigger) {
    case "rep_initiated":
      lines.push("Draft an outreach email for this contact. Make it compelling and personalized.");
      break;
    case "auto_overdue":
      lines.push(
        `This contact is ${ctx.daysOverdue} days overdue (threshold: ${ctx.cadenceThreshold} days). ` +
        `Draft a re-engagement email. Acknowledge the gap tactfully without being apologetic.`
      );
      break;
    case "meeting_prep":
      lines.push(
        `Draft a pre-meeting email for "${ctx.meetingTitle}" on ${ctx.meetingTime}. ` +
        `Include relevant talking points and data. Keep it brief and focused on what ` +
        `you'll discuss in the meeting.`
      );
      break;
  }

  return lines.join("\n");
}

export interface StyleGuide {
  tone_and_voice: string;
  opening_style: string;
  closing_and_signoff: string;
  things_to_avoid: string;
  example_phrases: string;
}

/**
 * Builds the style block for a rep's personal writing style.
 * Injected as a second system message with cache_control.
 * Returns null if any section is empty (guide not completed).
 */
export function buildStyleBlock(guide: StyleGuide): string | null {
  if (!guide.tone_and_voice && !guide.opening_style && !guide.closing_and_signoff) {
    return null;
  }

  return `Match this rep's writing style exactly. Here is their style profile:

## Tone & Voice
${guide.tone_and_voice}

## Opening Style
${guide.opening_style}

## Closing & Sign-off
${guide.closing_and_signoff}

## Things to Avoid
${guide.things_to_avoid}

## Example Phrases They Use
${guide.example_phrases}

Apply these patterns naturally. The email should sound like this specific person wrote it, not like a generic AI draft.`;
}
