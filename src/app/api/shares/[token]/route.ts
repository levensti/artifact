import { NextResponse } from "next/server";
import { authedRoute } from "@/server/api";
import { revokeShare } from "@/server/shares";

type Ctx = { params: Promise<{ token: string }> };

export const DELETE = authedRoute(
  async (userId, _req: Request, { params }: Ctx) => {
    const { token } = await params;
    await revokeShare(userId, token);
    return NextResponse.json({ ok: true });
  },
);
