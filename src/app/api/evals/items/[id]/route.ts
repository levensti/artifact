import { NextResponse } from "next/server";
import { adminRoute, getItemResponse } from "@/server/evals";

/** GET /api/evals/items/[id] — the model response for one item (inspector). */
export const GET = adminRoute(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const item = await getItemResponse(id);
    if (!item) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }
    return NextResponse.json(item);
  },
);
