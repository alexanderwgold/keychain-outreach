import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { googleApiFetch } from "../_shared/google-auth.ts";

export interface MeetingDetected {
  contactName: string;
  contactId: string;
  opportunityId: string;
  eventTitle: string;
  eventTime: string;
  inferredType: string;
  isToday: boolean;
}

export interface ScanCalendarResult {
  meetingsToday: MeetingDetected[];
  upcomingMeetings: MeetingDetected[];
  progressions: { accountName: string; fromType: string; toType: string }[];
  prepDraftsCreated: number;
  error?: string;
}

const CALENDAR_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

const MEETING_TYPE_KEYWORDS: [string, string][] = [
  ["intro", "intro"],
  ["demo", "meeting"],
  ["meeting", "meeting"],
  ["proposal", "proposal"],
  ["pricing", "proposal"],
  ["next steps", "next_steps"],
  ["follow", "next_steps"],
  ["catch", "catch_up"],
  ["check in", "catch_up"],
];

function inferMeetingType(title: string): string {
  const lower = title.toLowerCase();
  for (const [keyword, type] of MEETING_TYPE_KEYWORDS) {
    if (lower.includes(keyword)) return type;
  }
  return "unknown";
}

export async function scanCalendar(
  repEmail: string,
  accessToken: string,
  client: SupabaseClient
): Promise<ScanCalendarResult> {
  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    const weekAhead = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

    const params = new URLSearchParams({
      timeMin: today.toISOString(),
      timeMax: weekAhead.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "100",
    });

    const calResponse = await googleApiFetch(
      `${CALENDAR_EVENTS_URL}?${params}`,
      accessToken
    );

    if (!calResponse.ok) {
      return { meetingsToday: [], upcomingMeetings: [], progressions: [], prepDraftsCreated: 0, error: `Calendar API failed: ${calResponse.status}` };
    }

    const calData = await calResponse.json();
    const events = calData.items ?? [];

    const { data: opportunities } = await client
      .from("opportunities")
      .select("id, account_name, stage_name, opportunity_contacts(contacts(id, email, first_name, last_name))")
      .eq("rep_email", repEmail)
      .not("stage_name", "is", null);

    const emailToContact = new Map<string, { contactId: string; contactName: string; opportunityId: string; accountName: string }>();
    for (const opp of opportunities ?? []) {
      for (const oc of opp.opportunity_contacts ?? []) {
        const c = oc.contacts;
        if (c?.email) {
          emailToContact.set(c.email.toLowerCase(), {
            contactId: c.id,
            contactName: `${c.first_name} ${c.last_name}`,
            opportunityId: opp.id,
            accountName: opp.account_name,
          });
        }
      }
    }

    const meetingsToday: MeetingDetected[] = [];
    const upcomingMeetings: MeetingDetected[] = [];
    const progressions: { accountName: string; fromType: string; toType: string }[] = [];
    let prepDraftsCreated = 0;

    for (const event of events) {
      const attendees = event.attendees ?? [];
      const attendeeEmails = attendees.map((a: { email: string }) => a.email?.toLowerCase()).filter(Boolean);

      let match: { contactId: string; contactName: string; opportunityId: string; accountName: string } | undefined;
      for (const email of attendeeEmails) {
        match = emailToContact.get(email);
        if (match) break;
      }

      if (!match) continue;

      const eventStart = new Date(event.start?.dateTime ?? event.start?.date ?? "");
      const isToday = eventStart >= today && eventStart < tomorrow;
      const inferredType = inferMeetingType(event.summary ?? "");

      const meeting: MeetingDetected = {
        contactName: match.contactName,
        contactId: match.contactId,
        opportunityId: match.opportunityId,
        eventTitle: event.summary ?? "Untitled",
        eventTime: eventStart.toISOString(),
        inferredType,
        isToday,
      };

      if (isToday) {
        meetingsToday.push(meeting);
        await client.from("activity_log").insert({
          opportunity_id: match.opportunityId,
          contact_id: match.contactId,
          rep_email: repEmail,
          activity_type: "meeting_held",
          activity_date: eventStart.toISOString(),
          subject: event.summary,
          notes: JSON.stringify({ calendar_event_id: event.id, attendees: attendeeEmails }),
          source: "calendar_scan",
        });
      } else {
        upcomingMeetings.push(meeting);
      }

      await client.from("upcoming_meetings").upsert({
        opportunity_id: match.opportunityId,
        contact_id: match.contactId,
        rep_email: repEmail,
        meeting_title: event.summary,
        meeting_date: eventStart.toISOString(),
        attendees: attendeeEmails,
        inferred_type: inferredType,
      }, {
        onConflict: "opportunity_id,meeting_date",
      });
    }

    return { meetingsToday, upcomingMeetings, progressions, prepDraftsCreated };
  } catch (e) {
    return { meetingsToday: [], upcomingMeetings: [], progressions: [], prepDraftsCreated: 0, error: (e as Error).message };
  }
}
