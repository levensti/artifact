import { NextResponse } from "next/server";
import { adminRoute } from "@/server/api";
import * as store from "@/server/store";
import { deleteAudio } from "@/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Poll a single episode (drives the client's generating → ready transition). */
export const GET = adminRoute(async (userId, _req: Request, { params }: Ctx) => {
  const { id } = await params;
  const podcast = await store.getPodcast(userId, id);
  if (!podcast) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ podcast });
});

export const DELETE = adminRoute(async (userId, _req: Request, { params }: Ctx) => {
  const { id } = await params;
  const audioPath = await store.deletePodcastRecord(userId, id);
  if (audioPath) {
    await deleteAudio(audioPath).catch((err) =>
      console.warn("podcast audio delete failed (ignored):", err),
    );
  }
  return NextResponse.json({ ok: true });
});
