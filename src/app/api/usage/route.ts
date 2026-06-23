import { NextResponse } from "next/server";
import { authedRoute } from "@/server/api";
import { platformOpenRouterAvailable } from "@/server/provider-env";
import { getUsageStatus } from "@/server/rate-limit";

export const dynamic = "force-dynamic";

export const GET = authedRoute(async (userId) => {
  const usage = await getUsageStatus(userId);
  return NextResponse.json({
    platformOpenRouter: platformOpenRouterAvailable(),
    usage,
  });
});
