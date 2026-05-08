import "server-only";
import { prisma } from "./db";

export enum SlackEventType {
  Signup = "signup",
  Signin = "signin",
  ReviewInitiated = "review_initiated",
  ShareLinkCreated = "share_link_created",
  ImportShareCompleted = "import_share_completed",
  DiscoveryInitiated = "discovery_initiated",
  ReviewMessageSent = "review_message_sent",
  NoteAdded = "note_added",
}

const EMOJI: Record<SlackEventType, string> = {
  [SlackEventType.Signup]: ":tada:",
  [SlackEventType.Signin]: ":wave:",
  [SlackEventType.ReviewInitiated]: ":mag:",
  [SlackEventType.ShareLinkCreated]: ":link:",
  [SlackEventType.ImportShareCompleted]: ":inbox_tray:",
  [SlackEventType.DiscoveryInitiated]: ":compass:",
  [SlackEventType.ReviewMessageSent]: ":speech_balloon:",
  [SlackEventType.NoteAdded]: ":pencil2:",
};

export async function sendSlackEvent(
  type: SlackEventType,
  message: string,
  userId?: string,
): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[slack:${type}] ${message} (SLACK_WEBHOOK_URL unset)`);
    }
    return;
  }

  let who = "";
  if (userId) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, email: true },
      });
      if (user) {
        const label = user.name?.trim() || user.email || userId;
        who = ` _${label}_`;
      }
    } catch (err) {
      console.error("sendSlackEvent user lookup failed:", err);
    }
  }

  const text = `${EMOJI[type]} *[${type}]*${who} ${message}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      console.error(
        `sendSlackEvent failed: ${res.status} ${res.statusText}`,
      );
    }
  } catch (err) {
    console.error("sendSlackEvent error:", err);
  }
}
