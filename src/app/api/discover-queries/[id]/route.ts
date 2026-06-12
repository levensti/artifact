import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute } from "@/server/api";
import * as store from "@/server/store";
import { parsePicks, type ParsedPick } from "@/lib/picks-parser";

type Ctx = { params: Promise<{ id: string }> };

const pickSchema = z.object({
  url: z.string().min(1),
  title: z.string().min(1),
  rationale: z.string().default(""),
  arxivId: z.string().optional(),
  authors: z.string().nullable().optional(),
  publishedDate: z.string().nullable().optional(),
  publishedYear: z.number().int().nullable().optional(),
  venue: z.string().nullable().optional(),
  citationCount: z.number().int().nullable().optional(),
});

const finalizeSchema = z.object({
  status: z.enum(["complete", "errored"]),
  /** Auxiliary text the agent emitted (Plan + Verify line + closing
   *  acknowledgement). Stored on DiscoverQuery.notes for context. */
  notes: z.string().nullable().optional(),
  /** Structured picks captured from the `submit_picks` tool call. When
   *  absent, the server falls back to parsing `text` as Markdown. */
  picks: z.array(pickSchema).optional(),
  /** Final assistant text. Used as the parser fallback when the agent
   *  didn't call `submit_picks`. */
  text: z.string().optional(),
});

export const POST = authedRoute(
  async (userId, request: Request, { params }: Ctx) => {
    const { id } = await params;
    const body = finalizeSchema.parse(await request.json());

    let picks: ParsedPick[] = [];
    let notes: string | null = body.notes ?? null;

    if (body.picks && body.picks.length > 0) {
      // Structured path: trust the tool args.
      picks = body.picks.map((p) => ({
        url: p.url,
        title: p.title,
        rationale: p.rationale,
        arxivId: p.arxivId,
        authors: p.authors ?? null,
        publishedDate: p.publishedDate ?? null,
        publishedYear: p.publishedYear ?? null,
        venue: p.venue ?? null,
        citationCount: p.citationCount ?? null,
      }));
    } else if (body.text) {
      // Fallback: parse Markdown picks from the agent text. Kept as a
      // safety net for cases where the agent skipped the structured
      // tool — graceful degradation rather than total failure.
      const parsed = parsePicks(body.text);
      if (parsed) {
        picks = parsed.picks;
        if (notes == null) notes = parsed.pre.trim() || null;
      } else if (notes == null) {
        notes = body.text.trim() || null;
      }
    }

    if (notes && notes.length === 0) notes = null;

    const result = await store.finalizeDiscoverQuery(userId, id, {
      notes,
      picks,
      status: body.status,
    });
    return NextResponse.json(result);
  },
);

export const DELETE = authedRoute(
  async (userId, _req: Request, { params }: Ctx) => {
    const { id } = await params;
    await store.deleteDiscoverQuery(userId, id);
    return NextResponse.json({ ok: true });
  },
);
