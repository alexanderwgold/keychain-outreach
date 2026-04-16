import { googleApiFetch } from "../_shared/google-auth.ts";

export interface PendingDraft {
  contactName: string;
  subject: string;
  createdAt: string;
  draftId: string;
}

export interface CheckDraftStatusResult {
  pendingDrafts: PendingDraft[];
  error?: string;
}

const GMAIL_DRAFTS_URL = "https://gmail.googleapis.com/gmail/v1/users/me/drafts";

export async function checkDraftStatus(
  accessToken: string
): Promise<CheckDraftStatusResult> {
  try {
    const response = await googleApiFetch(
      `${GMAIL_DRAFTS_URL}?maxResults=20`,
      accessToken
    );

    if (!response.ok) {
      return { pendingDrafts: [], error: `Gmail drafts API failed: ${response.status}` };
    }

    const data = await response.json();
    const drafts = data.drafts ?? [];
    const pendingDrafts: PendingDraft[] = [];

    for (const draft of drafts) {
      const draftResponse = await googleApiFetch(
        `${GMAIL_DRAFTS_URL}/${draft.id}`,
        accessToken
      );

      if (!draftResponse.ok) continue;

      const draftData = await draftResponse.json();
      const headers = draftData.message?.payload?.headers ?? [];
      const subject = headers.find((h: { name: string }) => h.name === "Subject")?.value ?? "";
      const to = headers.find((h: { name: string }) => h.name === "To")?.value ?? "";
      const date = headers.find((h: { name: string }) => h.name === "Date")?.value ?? "";

      pendingDrafts.push({
        contactName: to,
        subject,
        createdAt: date,
        draftId: draft.id,
      });
    }

    return { pendingDrafts };
  } catch (e) {
    return { pendingDrafts: [], error: (e as Error).message };
  }
}
