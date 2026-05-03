import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute } from "@/server/api";
import * as projects from "@/server/projects";
import type { ChatMessage } from "@/lib/review-types";

type Ctx = { params: Promise<{ id: string }> };

export const GET = authedRoute(async (userId, _req: Request, { params }: Ctx) => {
  const { id } = await params;
  const messages = await projects.getProjectMessages(userId, id);
  return NextResponse.json({ messages });
});

const putSchema = z.object({
  // The full ChatMessage shape lives in `review-types.ts`. Use a passthrough
  // schema here — the projects code stores them as opaque JSON and the
  // renderer is shared with per-review chats.
  messages: z.array(z.unknown()),
});

export const PUT = authedRoute(
  async (userId, request: Request, { params }: Ctx) => {
    const { id } = await params;
    const body = putSchema.parse(await request.json());
    await projects.setProjectMessages(
      userId,
      id,
      body.messages as unknown as ChatMessage[],
    );
    return NextResponse.json({ ok: true });
  },
);
