import { NextResponse } from "next/server";
import { authedRoute } from "@/server/api";
import { auth } from "@/server/auth";
import * as store from "@/server/store";
import {
  platformOpenRouterAvailable,
  platformToolAvailability,
} from "@/server/provider-env";

export const dynamic = "force-dynamic";

export const GET = authedRoute(async (userId) => {
  // Discover (queries + recommendations) is intentionally NOT bootstrapped:
  // only the /discover route reads it, so it's lazy-loaded there via
  // /api/discover-queries instead of riding in every page's bootstrap.
  const [reviews, settings, deepDives, session] = await Promise.all([
    store.listReviews(userId),
    store.getSettings(userId),
    store.listDeepDives(userId),
    auth(),
  ]);
  const user = session?.user
    ? {
        id: session.user.id,
        name: session.user.name ?? null,
        email: session.user.email ?? null,
        image: session.user.image ?? null,
      }
    : null;
  return NextResponse.json({
    reviews,
    settings,
    // Boolean only — whether a platform OpenRouter key is configured.
    // NEVER the key itself.
    platformOpenRouter: platformOpenRouterAvailable(),
    // Same shape, for tool keys (Exa). Lets the client suppress the
    // "add a key" prompt when the server already has one in env.
    platformTools: platformToolAvailability(),
    deepDives,
    user,
  });
});
