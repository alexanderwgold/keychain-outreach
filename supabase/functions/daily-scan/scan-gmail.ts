import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { googleApiFetch } from "../_shared/google-auth.ts";

export interface EmailActivity {
  contactName: string;
  contactId: string;
  opportunityId: string;
  type: "email_sent" | "email_received" | "reply_received";
  subject: string;
  messageId: string;
}

export interface ScanGmailResult {
  emailActivity: EmailActivity[];
  error?: string;
}

const GMAIL_MESSAGES_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages";

export async function scanGmail(
  repEmail: string,
  accessToken: string,
  lastScanAt: string | null,
  client: SupabaseClient
): Promise<ScanGmailResult> {
  try {
    const { data: contacts } = await client
      .from("opportunities")
      .select("id, opportunity_contacts(contacts(id, email, first_name, last_name))")
      .eq("rep_email", repEmail)
      .not("stage_name", "is", null);

    if (!contacts?.length) return { emailActivity: [] };

    const emailToContact = new Map<string, { contactId: string; contactName: string; opportunityId: string }>();
    for (const opp of contacts) {
      for (const oc of opp.opportunity_contacts ?? []) {
        const c = oc.contacts;
        if (c?.email) {
          emailToContact.set(c.email.toLowerCase(), {
            contactId: c.id,
            contactName: `${c.first_name} ${c.last_name}`,
            opportunityId: opp.id,
          });
        }
      }
    }

    if (emailToContact.size === 0) return { emailActivity: [] };

    const query = lastScanAt
      ? `after:${Math.floor(new Date(lastScanAt).getTime() / 1000)}`
      : "newer_than:1d";

    const searchResponse = await googleApiFetch(
      `${GMAIL_MESSAGES_URL}?q=${encodeURIComponent(query)}&maxResults=100`,
      accessToken
    );

    if (!searchResponse.ok) {
      return { emailActivity: [], error: `Gmail search failed: ${searchResponse.status}` };
    }

    const searchData = await searchResponse.json();
    const messages = searchData.messages ?? [];
    const emailActivity: EmailActivity[] = [];

    for (const msg of messages) {
      const msgResponse = await googleApiFetch(
        `${GMAIL_MESSAGES_URL}/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject`,
        accessToken
      );

      if (!msgResponse.ok) continue;

      const msgData = await msgResponse.json();
      const headers = msgData.payload?.headers ?? [];
      const from = headers.find((h: { name: string }) => h.name === "From")?.value ?? "";
      const to = headers.find((h: { name: string }) => h.name === "To")?.value ?? "";
      const subject = headers.find((h: { name: string }) => h.name === "Subject")?.value ?? "";

      const fromEmail = extractEmail(from);
      const toEmails = to.split(",").map(extractEmail);

      let match: { contactId: string; contactName: string; opportunityId: string } | undefined;
      let type: "email_sent" | "email_received" | "reply_received";

      if (fromEmail === repEmail) {
        for (const toEmail of toEmails) {
          match = emailToContact.get(toEmail.toLowerCase());
          if (match) break;
        }
        type = "email_sent";
      } else {
        match = emailToContact.get(fromEmail.toLowerCase());
        type = subject.toLowerCase().startsWith("re:") ? "reply_received" : "email_received";
      }

      if (!match) continue;

      const { count } = await client
        .from("activity_log")
        .select("*", { count: "exact", head: true })
        .like("notes", `%${msg.id}%`);

      if ((count ?? 0) > 0) continue;

      emailActivity.push({
        contactName: match.contactName,
        contactId: match.contactId,
        opportunityId: match.opportunityId,
        type,
        subject,
        messageId: msg.id,
      });

      await client.from("activity_log").insert({
        opportunity_id: match.opportunityId,
        contact_id: match.contactId,
        rep_email: repEmail,
        activity_type: type,
        activity_date: new Date().toISOString(),
        subject,
        notes: JSON.stringify({ gmail_message_id: msg.id }),
        source: "gmail_scan",
      });
    }

    return { emailActivity };
  } catch (e) {
    return { emailActivity: [], error: (e as Error).message };
  }
}

function extractEmail(headerValue: string): string {
  const match = headerValue.match(/<([^>]+)>/);
  return (match ? match[1] : headerValue).trim().toLowerCase();
}
