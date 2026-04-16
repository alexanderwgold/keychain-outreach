import { encode as base64Encode } from "https://deno.land/std@0.208.0/encoding/base64.ts";

export interface MimeAttachment {
  filename: string;
  mimeType: string;
  base64Content: string;
}

export interface MimeMessageOptions {
  to: string;
  cc?: string[];
  bcc?: string[];
  subject: string;
  htmlBody: string;
  attachments?: MimeAttachment[];
}

const BOUNDARY = "keychain_mime_boundary_" + Date.now().toString(36);

/**
 * Strips CR/LF/NUL from a header value. Defense against header-injection
 * attacks via user-controlled fields (to/cc/bcc/subject/filename).
 */
function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n\0]+/g, " ").trim();
}

/**
 * Escapes backslash and quote for use inside a quoted MIME parameter
 * (filename="..."). Returns the sanitized inner string without surrounding quotes.
 */
function quoteMimeParam(value: string): string {
  return sanitizeHeader(value).replace(/[\\"]/g, "\\$&");
}

/**
 * Builds an RFC 2822 MIME message string.
 * If attachments are present, creates a multipart/mixed message.
 * Otherwise, creates a simple text/html message.
 */
export function buildMimeMessage(options: MimeMessageOptions): string {
  const { to, cc, bcc, subject, htmlBody, attachments } = options;
  const lines: string[] = [];

  // Headers
  lines.push(`To: ${sanitizeHeader(to)}`);
  if (cc?.length) lines.push(`Cc: ${cc.map(sanitizeHeader).join(", ")}`);
  if (bcc?.length) lines.push(`Bcc: ${bcc.map(sanitizeHeader).join(", ")}`);
  lines.push(`Subject: ${sanitizeHeader(subject)}`);
  lines.push("MIME-Version: 1.0");

  if (attachments && attachments.length > 0) {
    lines.push(`Content-Type: multipart/mixed; boundary="${BOUNDARY}"`);
    lines.push("");

    // HTML body part
    lines.push(`--${BOUNDARY}`);
    lines.push("Content-Type: text/html; charset=UTF-8");
    lines.push("Content-Transfer-Encoding: 7bit");
    lines.push("");
    lines.push(htmlBody);

    // Attachment parts
    for (const attachment of attachments) {
      lines.push(`--${BOUNDARY}`);
      lines.push(`Content-Type: ${sanitizeHeader(attachment.mimeType)}; name="${quoteMimeParam(attachment.filename)}"`);
      lines.push("Content-Transfer-Encoding: base64");
      lines.push(`Content-Disposition: attachment; filename="${quoteMimeParam(attachment.filename)}"`);
      lines.push("");
      lines.push(attachment.base64Content);
    }

    lines.push(`--${BOUNDARY}--`);
  } else {
    lines.push("Content-Type: text/html; charset=UTF-8");
    lines.push("Content-Transfer-Encoding: 7bit");
    lines.push("");
    lines.push(htmlBody);
  }

  return lines.join("\r\n");
}

/**
 * Encodes a MIME message string as base64url (required by Gmail API).
 */
export function base64UrlEncode(mimeMessage: string): string {
  const encoded = base64Encode(new TextEncoder().encode(mimeMessage));
  return encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
