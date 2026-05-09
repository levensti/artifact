import { NextResponse } from "next/server";
import { authedRoute } from "@/server/api";
import { importShare } from "@/server/shares";
import { sendSlackEvent, SlackEventType } from "@/server/notifications";

type Ctx = { params: Promise<{ token: string }> };

export const POST = authedRoute(
  async (userId, _req: Request, { params }: Ctx) => {
    const { token } = await params;
    const result = await importShare(token, userId);
    if (!result.alreadyOwner) {
      await sendSlackEvent(
        SlackEventType.ImportShareCompleted,
        `imported share (${result.kind}, token ${token})`,
        userId,
      );
    }
    return NextResponse.json(result);
  },
);
