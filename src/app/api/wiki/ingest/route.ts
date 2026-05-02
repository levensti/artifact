import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute } from "@/server/api";
import * as store from "@/server/store";

const schema = z.object({
  pages: z.array(
    z.object({
      slug: z.string(),
      title: z.string(),
      content: z.string(),
      pageType: z.enum(["session", "digest"]),
      source: z
        .object({ reviewId: z.string(), passage: z.string().optional() })
        .optional(),
    }),
  ),
});

export const POST = authedRoute(async (userId, request: Request) => {
  const body = schema.parse(await request.json());
  const result = await store.wikiIngestFinalize(userId, body);
  return NextResponse.json(result);
});
