import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute } from "@/server/api";
import * as projects from "@/server/projects";

type Ctx = { params: Promise<{ id: string }> };

export const GET = authedRoute(async (userId, _req: Request, { params }: Ctx) => {
  const { id } = await params;
  const projectIds = await projects.getReviewProjects(userId, id);
  return NextResponse.json({ projectIds });
});

const putSchema = z.object({
  projectIds: z.array(z.string().min(1)),
});

export const PUT = authedRoute(
  async (userId, request: Request, { params }: Ctx) => {
    const { id } = await params;
    const body = putSchema.parse(await request.json());
    await projects.setReviewProjects(userId, id, body.projectIds);
    return NextResponse.json({ ok: true });
  },
);
