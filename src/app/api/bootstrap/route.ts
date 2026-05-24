import { NextResponse } from "next/server";
import { authedRoute } from "@/server/api";
import { auth } from "@/server/auth";
import * as store from "@/server/store";
import {
  platformProviderAvailability,
  platformToolAvailability,
} from "@/server/provider-env";

export const dynamic = "force-dynamic";

export const GET = authedRoute(async (userId) => {
  const [reviews, settings, deepDives, discoverQueries, recommendations, projects, session] =
    await Promise.all([
      store.listReviews(userId),
      store.getSettings(userId),
      store.listDeepDives(userId),
      store.listDiscoverQueries(userId),
      store.listRecommendations(userId),
      store.listProjects(userId),
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
    // Booleans only — which built-in providers have a platform-key
    // fallback configured. NEVER the key itself.
    platformProviders: platformProviderAvailability(),
    // Same shape, for tool keys (Exa). Lets the client suppress the
    // "add a key" prompt when the server already has one in env.
    platformTools: platformToolAvailability(),
    deepDives,
    discoverQueries,
    recommendations,
    projects,
    user,
  });
});
