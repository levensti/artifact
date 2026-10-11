import { NextResponse } from "next/server";
import { authedRoute } from "@/server/api";
import * as docs from "@/server/documents";

type Ctx = { params: Promise<{ hash: string }> };

/**
 * Labeled sections of a document (label, title, start page). The client
 * turns these into a page map so "§3.1.4" chips resolve for long documents
 * that have no LLM page map or structured parse.
 */
export const GET = authedRoute(async (_userId, _req: Request, { params }: Ctx) => {
  const { hash } = await params;
  return NextResponse.json({ sections: await docs.listCitableSections(hash) });
});
