import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute } from "@/server/api";
import { importShare } from "@/server/shares";

type Ctx = { params: Promise<{ token: string }> };

const bodySchema = z
  .object({
    /// Force a clone even when the caller is the share's owner. Used by
    /// the owner-side "import a copy" affordance for testing.
    force: z.boolean().optional(),
  })
  .optional();

export const POST = authedRoute(
  async (userId, request: Request, { params }: Ctx) => {
    const { token } = await params;
    let body: { force?: boolean } = {};
    try {
      const raw = await request.json();
      body = bodySchema.parse(raw) ?? {};
    } catch {
      // Empty / non-JSON body is fine — `force` defaults to false.
    }
    const result = await importShare(token, userId, { force: body.force });
    return NextResponse.json(result);
  },
);
