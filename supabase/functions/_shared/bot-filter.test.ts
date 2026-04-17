// supabase/functions/_shared/bot-filter.test.ts

import { assertEquals } from "https://deno.land/std@0.218.2/assert/mod.ts"
import { isBotUserAgent } from "./bot-filter.ts"

Deno.test("isBotUserAgent: flags GoogleImageProxy (Gmail preview fetcher)", () => {
  assertEquals(isBotUserAgent("GoogleImageProxy"), true)
  assertEquals(
    isBotUserAgent("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"),
    true,
  )
})

Deno.test("isBotUserAgent: flags Slack unfurler", () => {
  assertEquals(isBotUserAgent("Slackbot-LinkExpanding 1.0"), true)
})

Deno.test("isBotUserAgent: flags Outlook SafeLinks", () => {
  assertEquals(
    isBotUserAgent("Mozilla/5.0 (compatible; Microsoft Outlook SafeLinks)"),
    true,
  )
})

Deno.test("isBotUserAgent: flags common automation", () => {
  assertEquals(isBotUserAgent("Python-urllib/3.11"), true)
  assertEquals(isBotUserAgent("curl/8.4.0"), true)
  assertEquals(isBotUserAgent(""), true) // empty UA is suspicious
  assertEquals(isBotUserAgent(null), true)
})

Deno.test("isBotUserAgent: passes real browsers", () => {
  const chrome = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
  const safari = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1"
  assertEquals(isBotUserAgent(chrome), false)
  assertEquals(isBotUserAgent(safari), false)
})
