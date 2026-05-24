import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute } from "@/server/api";
import * as store from "@/server/store";

export const dynamic = "force-dynamic";

export const GET = authedRoute(async (userId) => {
  const projects = await store.listProjects(userId);
  return NextResponse.json({ projects });
});

const createSchema = z.object({
  name: z.string().min(1).max(100),
});

export const POST = authedRoute(async (userId, request: Request) => {
  const body = createSchema.parse(await request.json());
  const project = await store.createProject(userId, body);
  return NextResponse.json({ project }, { status: 201 });
});
