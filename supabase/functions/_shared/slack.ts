const SLACK_API = "https://slack.com/api";

function getSlackToken(): string {
  const token = Deno.env.get("SLACK_BOT_TOKEN");
  if (!token) throw new Error("SLACK_BOT_TOKEN not set");
  return token;
}

async function slackPost(method: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getSlackToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!data.ok) {
    throw new Error(`Slack ${method} failed: ${data.error}`);
  }
  return data;
}

/**
 * Looks up a Slack user ID by their email address.
 * Requires `users:read.email` scope.
 */
export async function lookupSlackUser(email: string): Promise<string> {
  const data = await slackPost("users.lookupByEmail", { email });
  return (data.user as { id: string }).id;
}

/**
 * Opens a DM channel with a Slack user and sends a message.
 * Requires `chat:write` scope.
 */
export async function sendSlackDM(email: string, message: string): Promise<void> {
  const userId = await lookupSlackUser(email);

  const dmData = await slackPost("conversations.open", { users: userId });
  const channelId = (dmData.channel as { id: string }).id;

  await slackPost("chat.postMessage", {
    channel: channelId,
    text: message,
    mrkdwn: true,
  });
}

/**
 * Sends a message to a specific Slack channel by ID.
 */
export async function sendSlackMessage(channelId: string, message: string): Promise<void> {
  await slackPost("chat.postMessage", {
    channel: channelId,
    text: message,
    mrkdwn: true,
  });
}
