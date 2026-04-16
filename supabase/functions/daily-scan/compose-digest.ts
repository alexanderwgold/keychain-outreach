import { sendSlackDM } from "../_shared/slack.ts";
import type { SfUpdate } from "./scan-sf-email.ts";
import type { EmailActivity } from "./scan-gmail.ts";
import type { MeetingDetected } from "./scan-calendar.ts";
import type { OverdueContact } from "./eval-cadence.ts";
import type { PendingDraft } from "./check-draft-status.ts";

export interface DigestInput {
  repEmail: string;
  sfUpdates: SfUpdate[];
  emailActivity: EmailActivity[];
  meetingsToday: MeetingDetected[];
  upcomingMeetings: MeetingDetected[];
  overdue: OverdueContact[];
  pendingDrafts: PendingDraft[];
}

export async function composeAndSendDigest(input: DigestInput): Promise<{ sent: boolean; error?: string }> {
  try {
    const today = new Date().toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });

    const sections: string[] = [];
    sections.push(`*Daily Briefing — ${today}*\n`);

    if (input.sfUpdates.length > 0) {
      sections.push("*SF Updates Detected*");
      for (const u of input.sfUpdates.slice(0, 10)) {
        sections.push(`• ${u.accountName} — ${u.field}: ${u.oldValue ?? "—"} → ${u.newValue}`);
      }
      sections.push("");
    }

    const sent = input.emailActivity.filter((e) => e.type === "email_sent").length;
    const received = input.emailActivity.filter((e) => e.type === "email_received" || e.type === "reply_received").length;
    const meetings = input.meetingsToday.length;
    if (sent > 0 || received > 0 || meetings > 0) {
      sections.push("*Activity Today*");
      const parts: string[] = [];
      if (sent > 0) parts.push(`${sent} emails sent`);
      if (received > 0) parts.push(`${received} received`);
      if (meetings > 0) parts.push(`${meetings} meeting${meetings > 1 ? "s" : ""} held`);
      sections.push(`• ${parts.join(", ")}`);
      sections.push("");
    }

    if (input.pendingDrafts.length > 0) {
      sections.push("*Drafts Ready in Gmail*");
      for (const d of input.pendingDrafts.slice(0, 5)) {
        sections.push(`• ${d.contactName} — "${d.subject}" (${d.createdAt})`);
      }
      sections.push("");
    }

    if (input.overdue.length > 0) {
      sections.push("*Follow-Ups Due*");
      for (const o of input.overdue.slice(0, 10)) {
        const prefix = o.isCritical ? "• :warning: *" : "• ";
        const suffix = o.isCritical ? `* — ${o.daysSince} days overdue (threshold: ${o.threshold}d)` : ` — ${o.daysSince} days overdue (threshold: ${o.threshold}d)`;
        const autoDraftNote = o.autoDrafted ? " _(auto-drafted)_" : "";
        sections.push(`${prefix}${o.accountName}${suffix}${autoDraftNote}`);
      }
      sections.push("");
    }

    if (input.upcomingMeetings.length > 0) {
      sections.push("*Upcoming Meetings (Next 7 Days)*");
      for (const m of input.upcomingMeetings.slice(0, 5)) {
        const date = new Date(m.eventTime).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
        sections.push(`• ${date}: ${m.eventTitle} — ${m.contactName}`);
      }
      sections.push("");
    }

    const message = sections.join("\n");

    if (sections.length <= 2) {
      return { sent: false };
    }

    await sendSlackDM(input.repEmail, message);
    return { sent: true };
  } catch (e) {
    return { sent: false, error: (e as Error).message };
  }
}

export async function composeAndSendFounderDigest(
  founderEmails: string[],
  repResults: { repEmail: string; overdue: OverdueContact[]; emailActivity: EmailActivity[]; meetingsToday: MeetingDetected[]; success: boolean }[]
): Promise<void> {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const successCount = repResults.filter((r) => r.success).length;
  const totalSent = repResults.reduce((sum, r) => sum + r.emailActivity.filter((e) => e.type === "email_sent").length, 0);
  const totalReceived = repResults.reduce((sum, r) => sum + r.emailActivity.filter((e) => e.type !== "email_sent").length, 0);
  const totalMeetings = repResults.reduce((sum, r) => sum + r.meetingsToday.length, 0);

  const sections: string[] = [];
  sections.push(`*Team Activity Report — ${today}*\n`);

  sections.push("*Coverage Summary*");
  sections.push(`• ${successCount}/${repResults.length} reps scanned successfully`);
  sections.push(`• ${totalSent} emails sent today, ${totalReceived} received, ${totalMeetings} meetings held`);
  sections.push("");

  const repsWithOverdue = repResults
    .filter((r) => r.overdue.length >= 5)
    .sort((a, b) => b.overdue.length - a.overdue.length)
    .slice(0, 5);

  if (repsWithOverdue.length > 0) {
    sections.push("*Attention Needed*");
    sections.push(`• ${repsWithOverdue.length} reps with 5+ overdue contacts`);
    for (const r of repsWithOverdue) {
      const maxOverdue = Math.max(...r.overdue.map((o) => o.daysSince));
      sections.push(`• ${r.repEmail.split("@")[0]}: ${r.overdue.length} overdue (highest: ${maxOverdue} days)`);
    }
    sections.push("");
  }

  const message = sections.join("\n");

  for (const email of founderEmails) {
    try {
      await sendSlackDM(email, message);
    } catch (e) {
      console.error(`Failed to send founder digest to ${email}:`, (e as Error).message);
    }
  }
}
