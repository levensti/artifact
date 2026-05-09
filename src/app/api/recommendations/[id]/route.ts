import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute } from "@/server/api";
import * as store from "@/server/store";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  /** Toggle dismissed state. `true` sets dismissedAt, `false` clears it. */
  dismissed: z.boolean(),
});

export const PATCH = authedRoute(
  async (userId, request: Request, { params }: Ctx) => {
    const { id } = await params;
    const body = patchSchema.parse(await request.json());
    const recommendation = body.dismissed
      ? await store.dismissRecommendation(userId, id)
      : await store.undismissRecommendation(userId, id);
    return NextResponse.json({ recommendation });
  },
);
