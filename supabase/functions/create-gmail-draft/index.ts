import { createAdminClient } from "../_shared/supabase-client.ts";
import { refreshGoogleToken, googleApiFetch } from "../_shared/google-auth.ts";
import { corsPreflightResponse, jsonResponse } from "../_shared/cors.ts";
import { requireSelf } from "../_shared/auth.ts";
import { buildMimeMessage, base64UrlEncode, type MimeAttachment } from "./mime.ts";

const GMAIL_DRAFTS_URL = "https://gmail.googleapis.com/gmail/v1/users/me/drafts";

interface CreateDraftRequest {
  repEmail: string;
  to: string;
  cc?: string[];
  bcc?: string[];
  subject: string;
  htmlBody: string;
  contactId: string;
  opportunityId: string;
  attachments?: { storageKey: string; filename: string }[];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  let body: CreateDraftRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { repEmail, to, cc, bcc, subject, htmlBody, contactId, opportunityId, attachments } = body;
  if (!repEmail || !to || !subject || !htmlBody || !contactId || !opportunityId) {
    return jsonResponse(
      { error: "repEmail, to, subject, htmlBody, contactId, and opportunityId are required" },
      400
    );
  }

  const forbid = await requireSelf(req, repEmail);
  if (forbid) return forbid;

  try {
    const client = createAdminClient();

    // Step 1: Refresh Google access token
    const accessToken = await refreshGoogleToken(repEmail, client);

    // Step 2: Download attachments from Supabase Storage
    const mimeAttachments: MimeAttachment[] = [];
    const failedAttachments: string[] = [];
    if (attachments?.length) {
      for (const att of attachments) {
        const { data, error } = await client.storage
          .from("collateral")
          .download(att.storageKey);

        if (error) {
          console.error(`Failed to download ${att.storageKey}:`, error.message);
          failedAttachments.push(att.filename);
          continue;
        }

        const arrayBuffer = await data.arrayBuffer();
        const uint8 = new Uint8Array(arrayBuffer);
        let binary = "";
        for (const byte of uint8) {
          binary += String.fromCharCode(byte);
        }
        const base64Content = btoa(binary);

        const ext = att.filename.split(".").pop()?.toLowerCase() ?? "";
        const mimeTypes: Record<string, string> = {
          pdf: "application/pdf",
          doc: "application/msword",
          docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          png: "image/png",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
        };

        mimeAttachments.push({
          filename: att.filename,
          mimeType: mimeTypes[ext] ?? "application/octet-stream",
          base64Content,
        });
      }
    }

    // Step 3: Build MIME message
    const mimeMessage = buildMimeMessage({
      to,
      cc,
      bcc,
      subject,
      htmlBody,
      attachments: mimeAttachments.length > 0 ? mimeAttachments : undefined,
    });

    const encodedMessage = base64UrlEncode(mimeMessage);

    // Step 4: Create Gmail draft
    const gmailResponse = await googleApiFetch(GMAIL_DRAFTS_URL, accessToken, {
      method: "POST",
      body: JSON.stringify({
        message: { raw: encodedMessage },
      }),
    });

    if (!gmailResponse.ok) {
      const text = await gmailResponse.text();
      console.error("Gmail draft creation failed:", text);
      return jsonResponse({ error: `Gmail API error: ${gmailResponse.status}` }, 502);
    }

    const draftData = await gmailResponse.json();
    const draftId = draftData.id;

    // Step 5: Log in activity_log
    await client.from("activity_log").insert({
      opportunity_id: opportunityId,
      contact_id: contactId,
      rep_email: repEmail,
      activity_type: "email_sent",
      activity_date: new Date().toISOString(),
      subject,
      notes: JSON.stringify({
        gmail_draft_id: draftId,
        attachments: attachments?.map((a) => a.filename) ?? [],
      }),
      source: "manual",
    });

    return jsonResponse({
      success: true,
      draftId,
      ...(failedAttachments.length > 0 ? { failedAttachments } : {}),
    });
  } catch (e) {
    console.error("create-gmail-draft error:", (e as Error).message);
    return jsonResponse({ error: (e as Error).message }, 500);
  }
});
