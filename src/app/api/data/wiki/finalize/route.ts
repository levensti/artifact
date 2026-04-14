import { NextRequest } from "next/server";
import { wikiIngestFinalize } from "@/lib/server/store";
import type { WikiPageType } from "@/lib/wiki";

export const runtime = "nodejs";

/**
 * Atomic "ingest finalize" endpoint. Takes a batch of pages + optional
 * log entry + optional index rebuild, and runs them all in a single
 * server-side transaction. Used by `runWikiIngest` and
 * `extractWikiFromResponse` so concurrent ingests can't clobber the
 * index page or lose log entries.
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
    rebuildIndex?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!Array.isArray(body.pages)) {
    return Response.json({ error: "pages must be an array" }, { status: 400 });
  }

  const result = wikiIngestFinalize({
    pages: body.pages,
    logEntry: body.logEntry,
    rebuildIndex: body.rebuildIndex ?? true,
  });
  return Response.json(result);
}
