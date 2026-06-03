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
  const [reviews, settings, deepDives, discoverQueries, recommendations, session] =
    await Promise.all([
      store.listReviews(userId),
      store.getSettings(userId),
      store.listDeepDives(userId),
      store.listDiscoverQueries(userId),
      store.listRecommendations(userId),
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
    discoverQueries,
    recommendations,
    user,
  });
});
