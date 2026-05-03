import { NextResponse } from "next/server";
import { authedRoute } from "@/server/api";
import { auth } from "@/server/auth";
import * as store from "@/server/store";
import * as projectsStore from "@/server/projects";

export const dynamic = "force-dynamic";

export const GET = authedRoute(async (userId) => {
  const [reviews, settings, deepDives, projects, session] = await Promise.all([
    store.listReviews(userId),
    store.getSettings(userId),
    store.listDeepDives(userId),
    projectsStore.listProjects(userId),
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
  return NextResponse.json({ reviews, settings, deepDives, projects, user });
});
