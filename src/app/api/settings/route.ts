import { NextResponse } from "next/server";
import { authedRoute } from "@/server/api";
import * as store from "@/server/store";
import type { SettingsPatch } from "@/server/store";
import {
  platformOpenRouterAvailable,
  platformToolAvailability,
} from "@/server/provider-env";

export const dynamic = "force-dynamic";

export const GET = authedRoute(async (userId) => {
  const settings = await store.getSettings(userId);
  return NextResponse.json({
    settings,
    platformOpenRouter: platformOpenRouterAvailable(),
    platformTools: platformToolAvailability(),
  });
});

export const PATCH = authedRoute(async (userId, request: Request) => {
  const patch = (await request.json()) as SettingsPatch;
  await store.patchSettings(userId, patch);
  const settings = await store.getSettings(userId);
  return NextResponse.json({
    settings,
    platformOpenRouter: platformOpenRouterAvailable(),
    platformTools: platformToolAvailability(),
  });
});
