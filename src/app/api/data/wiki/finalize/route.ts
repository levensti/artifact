import { NextRequest } from "next/server";
import { wikiIngestFinalize } from "@/lib/server/store";
import type { WikiPageType } from "@/lib/wiki";

export const runtime = "nodejs";

const ALLOWED_TYPES: ReadonlySet<WikiPageType> = new Set(["session", "digest"]);

/**
 * Atomic "ingest finalize" endpoint. Takes a batch of journal pages
 * (sessions + digests) and writes them in a single server-side
 * transaction. Used by the session/digest ambient generators.
 */
export async function POST(req: NextRequest) {
  let body: {
    pages: Array<{
      slug: string;
      title: string;
      content: string;
      pageType: WikiPageType;
      source?: { reviewId: string; passage?: string };
    }>;
    logEntry?: { label: string; kind?: string };
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!Array.isArray(body.pages)) {
    return Response.json({ error: "pages must be an array" }, { status: 400 });
  }
  for (const p of body.pages) {
    if (!ALLOWED_TYPES.has(p.pageType)) {
      return Response.json(
        { error: `Invalid pageType: ${p.pageType}` },
        { status: 400 },
      );
    }
  }

  const result = wikiIngestFinalize({
    pages: body.pages,
    logEntry: body.logEntry,
  });
  return Response.json(result);
}
