import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { buildMimeMessage, base64UrlEncode } from "./mime.ts";

Deno.test("buildMimeMessage: simple email without attachments", () => {
  const mime = buildMimeMessage({
    to: "john@example.com",
    subject: "Hello",
    htmlBody: "<p>Hi John</p>",
  });
  assertStringIncludes(mime, "To: john@example.com");
  assertStringIncludes(mime, "Subject: Hello");
  assertStringIncludes(mime, "Content-Type: text/html; charset=UTF-8");
  assertStringIncludes(mime, "<p>Hi John</p>");
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

Deno.test("base64UrlEncode: encodes correctly", () => {
  const result = base64UrlEncode("Hello World");
  assertEquals(typeof result, "string");
  assertEquals(result.includes("+"), false);
  assertEquals(result.includes("/"), false);
});
