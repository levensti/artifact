import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute } from "@/server/api";
import { computeShouldCompact } from "@/lib/openrouter";
import * as store from "@/server/store";
import type { ChatMessage, ContextUsage } from "@/lib/review-types";

type Ctx = { params: Promise<{ id: string }> };

export const GET = authedRoute(async (userId, _req: Request, { params }: Ctx) => {
  const { id } = await params;
  const { messages, contextMetadata } = await store.getConversation(userId, id);
  // Derive the small client-facing usage view (no recap text, no threshold
  // logic) so a reload re-seeds the meter and re-evaluates auto-compaction.
  let contextUsage: ContextUsage | null = null;
  if (
    contextMetadata?.lastContextTokens != null &&
    contextMetadata.windowTokens != null
  ) {
    const usedTokens = contextMetadata.lastContextTokens;
    const windowTokens = contextMetadata.windowTokens;
    contextUsage = {
      usedTokens,
      windowTokens,
      shouldCompact: computeShouldCompact(usedTokens, windowTokens),
      paperTokens: contextMetadata.paperTokens,
      overheadTokens: contextMetadata.overheadTokens,
    };
  }
  return NextResponse.json({ messages, contextUsage });
});

const putSchema = z.object({ messages: z.array(z.unknown()) });

export const PUT = authedRoute(async (userId, request: Request, { params }: Ctx) => {
  const { id } = await params;
  const body = putSchema.parse(await request.json());
  // An explicit client overwrite (e.g. clearing the chat) invalidates any
  // compaction recap and the measured usage, so reset the context metadata.
  await store.setMessages(userId, id, body.messages as ChatMessage[], {});
  return NextResponse.json({ ok: true });
});
