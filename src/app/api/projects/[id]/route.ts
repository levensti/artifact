import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute } from "@/server/api";
import * as projects from "@/server/projects";

type Ctx = { params: Promise<{ id: string }> };

export const GET = authedRoute(async (userId, _req: Request, { params }: Ctx) => {
  const { id } = await params;
  const project = await projects.getProject(userId, id);
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ project });
});

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullish(),
  notes: z.string().nullish(),
  color: z.string().nullish(),
  archived: z.boolean().optional(),
});

export const PATCH = authedRoute(
  async (userId, request: Request, { params }: Ctx) => {
    const { id } = await params;
    const body = patchSchema.parse(await request.json());
    const patch: Parameters<typeof projects.updateProject>[2] = {
      name: body.name,
      archived: body.archived,
    };
    // Pass through nullables only when explicitly set (zod's .nullish()
    // gives us undefined when omitted, null when the client wants to
    // clear). Bare assignment via ?? would conflate the two.
    if ("description" in body) patch.description = body.description ?? null;
    if ("notes" in body) patch.notes = body.notes ?? null;
    if ("color" in body) patch.color = body.color ?? null;
    const project = await projects.updateProject(userId, id, patch);
    return NextResponse.json({ project });
  },
);

export const DELETE = authedRoute(
  async (userId, _req: Request, { params }: Ctx) => {
    const { id } = await params;
    const ok = await projects.deleteProject(userId, id);
    if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  },
);
