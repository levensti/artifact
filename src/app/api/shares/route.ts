import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute } from "@/server/api";
import {
  createOrReuseShare,
  listSharesForUser,
} from "@/server/shares";

const createSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("review"),
    reviewId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("wiki"),
    wikiSlug: z.string().min(1),
    wikiDepth: z.number().int().min(0).max(3).optional(),
  }),
]);

export const POST = authedRoute(async (userId, request: Request) => {
  const parsed = createSchema.parse(await request.json());
  const result = await createOrReuseShare(userId, parsed);
  return NextResponse.json(result);
});

export const GET = authedRoute(async (userId) => {
  const shares = await listSharesForUser(userId);
  return NextResponse.json({ shares });
});
