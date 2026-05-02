import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute } from "@/server/api";
import * as store from "@/server/store";
import type { ChatMessage } from "@/lib/review-types";

type Ctx = { params: Promise<{ id: string }> };

export const GET = authedRoute(async (userId, _req: Request, { params }: Ctx) => {
  const { id } = await params;
  const messages = await store.getMessages(userId, id);
  return NextResponse.json({ messages });
});

const putSchema = z.object({ messages: z.array(z.unknown()) });

export const PUT = authedRoute(async (userId, request: Request, { params }: Ctx) => {
  const { id } = await params;
  const body = putSchema.parse(await request.json());
  await store.setMessages(userId, id, body.messages as ChatMessage[]);
  return NextResponse.json({ ok: true });
});
