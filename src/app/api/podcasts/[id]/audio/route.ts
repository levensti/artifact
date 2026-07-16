import { NextResponse } from "next/server";
import { adminRoute } from "@/server/api";
import * as store from "@/server/store";
import { downloadAudio } from "@/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Stream a ready episode's WAV audio (mirrors the PDF blob serve route). The
 *  raw storage path never leaves the server; the `<audio>` element points here. */
export const GET = adminRoute(async (userId, _req: Request, { params }: Ctx) => {
  const { id } = await params;
  const audioPath = await store.getPodcastAudioPath(userId, id);
  if (!audioPath) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const blob = await downloadAudio(audioPath);
  return new NextResponse(blob.stream(), {
    headers: {
      "Content-Type": "audio/wav",
      "Content-Length": String(blob.size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
    },
  });
});
