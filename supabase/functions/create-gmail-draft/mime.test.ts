import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { buildMimeMessage, base64UrlEncode } from "./mime.ts";

/**
 * Pulls the base64 body out of a MIME message and decodes it as UTF-8
 * text so tests can assert on the human-readable body content.
 */
function decodeBase64Body(mime: string, boundary?: string): string {
  // Find the Content-Transfer-Encoding: base64 block that belongs to the
  // HTML body (the first such block — attachments come later).
  const parts = boundary ? mime.split(`--${boundary}`) : [mime];
  for (const part of parts) {
    if (!part.includes("Content-Type: text/html")) continue;
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;
    const rawBody = part.slice(headerEnd + 4).trim();
    // Strip trailing boundary markers / empty lines
    const base64 = rawBody.split("\r\n").join("");
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8").decode(bytes);
  }
  return "";
}

Deno.test("buildMimeMessage: simple email without attachments", () => {
  const mime = buildMimeMessage({
    to: "john@example.com",
    subject: "Hello",
    htmlBody: "<p>Hi John</p>",
  });
  assertStringIncludes(mime, "To: john@example.com");
  assertStringIncludes(mime, "Subject: Hello");
  assertStringIncludes(mime, "Content-Type: text/html; charset=UTF-8");
  assertStringIncludes(mime, "Content-Transfer-Encoding: base64");
  assertEquals(decodeBase64Body(mime), "<p>Hi John</p>");
});

Deno.test("buildMimeMessage: includes Cc and Bcc", () => {
  const mime = buildMimeMessage({
    to: "john@example.com",
    cc: ["jane@example.com"],
    bcc: ["boss@example.com"],
    subject: "Hello",
    htmlBody: "<p>Hi</p>",
  });
  assertStringIncludes(mime, "Cc: jane@example.com");
  assertStringIncludes(mime, "Bcc: boss@example.com");
});

Deno.test("buildMimeMessage: with attachment creates multipart/mixed", () => {
  const mime = buildMimeMessage({
    to: "john@example.com",
    subject: "With attachment",
    htmlBody: "<p>See attached</p>",
    attachments: [{
      filename: "doc.pdf",
      mimeType: "application/pdf",
      base64Content: "dGVzdA==",
    }],
  });
  assertStringIncludes(mime, "Content-Type: multipart/mixed");
  assertStringIncludes(mime, 'Content-Disposition: attachment; filename="doc.pdf"');
  assertStringIncludes(mime, "dGVzdA==");
});

Deno.test("buildMimeMessage: multiple attachments", () => {
  const mime = buildMimeMessage({
    to: "john@example.com",
    subject: "Docs",
    htmlBody: "<p>Hi</p>",
    attachments: [
      { filename: "a.pdf", mimeType: "application/pdf", base64Content: "YQ==" },
      { filename: "b.pdf", mimeType: "application/pdf", base64Content: "Yg==" },
    ],
  });
  assertStringIncludes(mime, 'filename="a.pdf"');
  assertStringIncludes(mime, 'filename="b.pdf"');
});

Deno.test("buildMimeMessage: preserves non-ASCII body through base64", () => {
  const body = "<p>Café — naïve résumé 日本語</p>";
  const mime = buildMimeMessage({
    to: "john@example.com",
    subject: "Hello",
    htmlBody: body,
  });
  assertEquals(decodeBase64Body(mime), body);
});

Deno.test("buildMimeMessage: ASCII subject passes through unchanged", () => {
  const mime = buildMimeMessage({
    to: "john@example.com",
    subject: "Plain ASCII subject",
    htmlBody: "<p>body</p>",
  });
  assertStringIncludes(mime, "Subject: Plain ASCII subject");
});

Deno.test("buildMimeMessage: non-ASCII subject gets RFC 2047 encoded-word", () => {
  const mime = buildMimeMessage({
    to: "john@example.com",
    subject: "Café résumé",
    htmlBody: "<p>body</p>",
  });
  assertStringIncludes(mime, "Subject: =?UTF-8?B?");
});

Deno.test("base64UrlEncode: encodes correctly", () => {
  const result = base64UrlEncode("Hello World");
  assertEquals(typeof result, "string");
  assertEquals(result.includes("+"), false);
  assertEquals(result.includes("/"), false);
});
