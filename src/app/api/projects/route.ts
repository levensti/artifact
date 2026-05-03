import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute } from "@/server/api";
import * as projects from "@/server/projects";

export const dynamic = "force-dynamic";

export const GET = authedRoute(async (userId) => {
  const list = await projects.listProjects(userId);
  return NextResponse.json({ projects: list });
});

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullish(),
  color: z.string().nullish(),
});

export const POST = authedRoute(async (userId, request: Request) => {
  const body = createSchema.parse(await request.json());
  const project = await projects.createProject(userId, {
    name: body.name,
    description: body.description ?? null,
    color: body.color ?? null,
  });
  return NextResponse.json({ project });
});
