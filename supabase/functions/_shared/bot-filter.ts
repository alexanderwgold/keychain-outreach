// supabase/functions/_shared/bot-filter.ts

const BOT_PATTERNS = [
  /googlebot/i,
  /googleimageproxy/i,
  /bingbot/i,
  /yahoo! slurp/i,
  /duckduckbot/i,
  /baiduspider/i,
  /yandexbot/i,
  /slackbot-linkexpanding/i,
  /slackbot/i,
  /discordbot/i,
  /facebookexternalhit/i,
  /twitterbot/i,
  /linkedinbot/i,
  /whatsapp/i,
  /telegrambot/i,
  /safelinks/i,
  /mimecast/i,
  /proofpoint/i,
  /barracuda/i,
  /python/i,
  /curl\//i,
  /wget/i,
  /headlesschrome/i,
  /bot$/i,
  /spider/i,
  /crawler/i,
]

export function isBotUserAgent(ua: string | null | undefined): boolean {
  if (!ua || ua.trim() === "") return true
  return BOT_PATTERNS.some((pattern) => pattern.test(ua))
}
