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
 * Encodes a header value as an RFC 2047 base64 encoded-word if it contains
 * non-ASCII characters. ASCII-only values pass through unchanged so typical
 * English subjects remain human-readable in the wire format.
 *
 * Note: encoded-words must NOT appear inside an addr-spec per RFC 2047, so
 * this helper should only be used for free-form fields (Subject, display
 * names inside address fields) — never on a bare email address.
 */
function encodeHeaderIfNeeded(value: string): string {
  const clean = sanitizeHeader(value);
  if (/^[\x00-\x7F]*$/.test(clean)) return clean;
  const utf8 = new TextEncoder().encode(clean);
  let binary = "";
  for (const byte of utf8) binary += String.fromCharCode(byte);
  return `=?UTF-8?B?${btoa(binary)}?=`;
}

/**
 * Base64-encodes a UTF-8 string and splits the output into 76-character
 * lines as required for `Content-Transfer-Encoding: base64` (RFC 2045).
 * This is the safe way to ship non-ASCII bodies through the MIME/Gmail
 * pipeline — a raw UTF-8 body written as-is can produce invalid byte
 * sequences once re-encoded.
 */
function base64EncodeBody(body: string): string {
  const utf8 = new TextEncoder().encode(body);
  let binary = "";
  for (const byte of utf8) binary += String.fromCharCode(byte);
  const encoded = btoa(binary);
  return encoded.replace(/(.{76})/g, "$1\r\n");
}

/**
 * Builds an RFC 2822 MIME message string.
 * If attachments are present, creates a multipart/mixed message.
 * Otherwise, creates a simple text/html message.
 */
export function buildMimeMessage(options: MimeMessageOptions): string {
  const { to, cc, bcc, subject, htmlBody, attachments } = options;
  const lines: string[] = [];

  // Headers. Addresses pass through sanitizeHeader only (bare addr-spec
  // must be ASCII; encoded-words are not allowed inside an addr-spec).
  // Subject uses encodeHeaderIfNeeded so non-ASCII subjects ride as
  // RFC 2047 encoded-words instead of raw bytes (which break per
  // RFC 5322 and are silently corrupted by many MTAs).
  lines.push(`To: ${sanitizeHeader(to)}`);
  if (cc?.length) lines.push(`Cc: ${cc.map(sanitizeHeader).join(", ")}`);
  if (bcc?.length) lines.push(`Bcc: ${bcc.map(sanitizeHeader).join(", ")}`);
  lines.push(`Subject: ${encodeHeaderIfNeeded(subject)}`);
  lines.push("MIME-Version: 1.0");

  // Always base64-encode the HTML body. This is simpler and safer than
  // gating on presence of non-ASCII characters — 7bit is only valid when
  // every octet is <= 127, which we can't guarantee for rep-authored
  // emails or Claude-drafted copy that may contain em-dashes / smart
  // quotes / accented names.
  const encodedBody = base64EncodeBody(htmlBody);

  if (attachments && attachments.length > 0) {
    lines.push(`Content-Type: multipart/mixed; boundary="${BOUNDARY}"`);
    lines.push("");

    // HTML body part
    lines.push(`--${BOUNDARY}`);
    lines.push("Content-Type: text/html; charset=UTF-8");
    lines.push("Content-Transfer-Encoding: base64");
    lines.push("");
    lines.push(encodedBody);

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
    lines.push("Content-Transfer-Encoding: base64");
    lines.push("");
    lines.push(encodedBody);
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
