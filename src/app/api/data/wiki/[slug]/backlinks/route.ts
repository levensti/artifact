import {
  getWikiBacklinks,
  getWikiPageSources,
  listWikiRevisions,
} from "@/lib/server/store";

export const runtime = "nodejs";

/**
 * Returns all the "around-the-page" metadata we need for the enriched
 * wiki-page-view: reverse links ([[slug]] refs from other pages), the
 * originating review sources (with passage + added_at), and a capped
 * revision summary for diff-on-update UI.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params;
  const decoded = decodeURIComponent(slug);
  return Response.json({
    backlinks: getWikiBacklinks(decoded),
    sources: getWikiPageSources(decoded),
    revisions: listWikiRevisions(decoded),
  });
}
