import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute } from "@/server/api";
import * as store from "@/server/store";

type Ctx = { params: Promise<{ id: string; artifactId: string }> };

/** One version's source: `?version=N`. */
export const GET = authedRoute(async (userId, req: Request, { params }: Ctx) => {
  const { id, artifactId } = await params;
  const version = z.coerce
    .number()
    .int()
    .positive()
    .parse(new URL(req.url).searchParams.get("version"));
  const v = await store.getArtifactVersion(userId, id, artifactId, version);
  return NextResponse.json({ version: v });
});

const actionSchema = z.object({
  /** restore: append a copy of `version`. split: move `version` (the latest
   *  edit) into a new artifact and restore the one before it. */
  action: z.enum(["restore", "split"]),
  version: z.number().int().positive(),
});

export const POST = authedRoute(async (userId, req: Request, { params }: Ctx) => {
  const { id, artifactId } = await params;
  const body = actionSchema.parse(await req.json());
  if (body.action === "restore") {
    const result = await store.restoreArtifactVersion(
      userId,
      id,
      artifactId,
      body.version,
    );
    return NextResponse.json(result);
  }
  const created = await store.splitArtifactVersion(userId, id, artifactId, body.version);
  return NextResponse.json({ created });
});

/** What the reader did inside the page, saved by the sandbox bridge. */
export const PUT = authedRoute(async (userId, req: Request, { params }: Ctx) => {
  const { id, artifactId } = await params;
  const body = z.object({ state: z.unknown() }).parse(await req.json());
  await store.setArtifactState(userId, id, artifactId, body.state ?? null);
  return NextResponse.json({ ok: true });
});
