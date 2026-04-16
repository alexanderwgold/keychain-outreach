import { createAdminClient } from "../_shared/supabase-client.ts";
import { refreshGoogleToken } from "../_shared/google-auth.ts";
import { scanSfEmail, type ScanSfEmailResult } from "./scan-sf-email.ts";
import { scanGmail, type ScanGmailResult } from "./scan-gmail.ts";
import { scanCalendar, type ScanCalendarResult } from "./scan-calendar.ts";
import { evalCadence, type EvalCadenceResult } from "./eval-cadence.ts";
import { checkDraftStatus, type CheckDraftStatusResult } from "./check-draft-status.ts";
import { composeAndSendDigest, composeAndSendFounderDigest } from "./compose-digest.ts";

const FOUNDER_EMAILS = ["alex.gold@keychain.com", "dusty.reese@keychain.com"];

interface RepScanResult {
  repEmail: string;
  success: boolean;
  sfResult: ScanSfEmailResult;
  gmailResult: ScanGmailResult;
  calendarResult: ScanCalendarResult;
  cadenceResult: EvalCadenceResult;
  draftStatusResult: CheckDraftStatusResult;
  digestSent: boolean;
  error?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const startTime = Date.now();
  const client = createAdminClient();

  const { data: reps, error: repError } = await client
    .from("rep_tokens")
    .select("rep_email, last_scan_at")
    .eq("is_active", true)
    .not("google_refresh_token", "is", null);

  if (repError || !reps?.length) {
    return new Response(
      JSON.stringify({ error: repError?.message ?? "No active reps found" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  console.log(`Daily scan starting for ${reps.length} reps`);

  const results: RepScanResult[] = await Promise.all(
    reps.map(async (rep): Promise<RepScanResult> => {
      const repEmail = rep.rep_email;
      const emptyResult: RepScanResult = {
        repEmail,
        success: false,
        sfResult: { sfUpdates: [] },
        gmailResult: { emailActivity: [] },
        calendarResult: { meetingsToday: [], upcomingMeetings: [], progressions: [], prepDraftsCreated: 0 },
        cadenceResult: { overdue: [] },
        draftStatusResult: { pendingDrafts: [] },
        digestSent: false,
      };

      try {
        const accessToken = await refreshGoogleToken(repEmail, client);

        const [sfResult, gmailResult, calendarResult, draftStatusResult] = await Promise.all([
          scanSfEmail(repEmail, accessToken, client),
          scanGmail(repEmail, accessToken, rep.last_scan_at, client),
          scanCalendar(repEmail, accessToken, client),
          checkDraftStatus(accessToken),
        ]);

        const cadenceResult = await evalCadence(repEmail, client);

        const digestResult = await composeAndSendDigest({
          repEmail,
          sfUpdates: sfResult.sfUpdates,
          emailActivity: gmailResult.emailActivity,
          meetingsToday: calendarResult.meetingsToday,
          upcomingMeetings: calendarResult.upcomingMeetings,
          overdue: cadenceResult.overdue,
          pendingDrafts: draftStatusResult.pendingDrafts,
        });

        const { error: lastScanError } = await client
          .from("rep_tokens")
          .update({ last_scan_at: new Date().toISOString() })
          .eq("rep_email", repEmail);
        if (lastScanError) {
          console.warn("last_scan_at update failed:", lastScanError.message);
        }

        return {
          repEmail,
          success: true,
          sfResult,
          gmailResult,
          calendarResult,
          cadenceResult,
          draftStatusResult,
          digestSent: digestResult.sent,
        };
      } catch (e) {
        console.error(`Scan failed for ${repEmail}:`, (e as Error).message);
        return { ...emptyResult, error: (e as Error).message };
      }
    })
  );

  try {
    await composeAndSendFounderDigest(
      FOUNDER_EMAILS,
      results.map((r) => ({
        repEmail: r.repEmail,
        overdue: r.cadenceResult.overdue,
        emailActivity: r.gmailResult.emailActivity,
        meetingsToday: r.calendarResult.meetingsToday,
        success: r.success,
      }))
    );
  } catch (e) {
    console.error("Founder digest failed:", (e as Error).message);
  }

  const duration = Date.now() - startTime;
  const successCount = results.filter((r) => r.success).length;

  console.log(`Daily scan complete: ${successCount}/${results.length} reps, ${duration}ms`);

  return new Response(
    JSON.stringify({
      repsScanned: results.length,
      repsSucceeded: successCount,
      repsFailed: results.length - successCount,
      durationMs: duration,
      failures: results.filter((r) => !r.success).map((r) => ({ rep: r.repEmail, error: r.error })),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
