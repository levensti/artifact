/**
 * Shared utility for turning `[[slug]]` wiki-reference syntax into a
 * normal markdown link that the assistant, chat UI, and wiki browse
 * view can all render identically.
 *
 * The downstream markdown renderer detects these links by their href
 * prefix and attaches hover previews.
 *
 * This file is the single source of truth for the wiki-link regex —
 * server-side link extraction, lint, and rendering all import from here
 * so they can't silently drift apart.
 */

/** Matches `[[slug]]` where slug is a-z/0-9/hyphens, length 1-80. */
export const WIKI_LINK_RE = /\[\[([a-z0-9][a-z0-9-]{0,79})\]\]/gi;

export const WIKI_LINK_HREF_PREFIX = "/wiki?page=";

/** Turn `transformer-architecture` → `Transformer Architecture`. */
function prettifySlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Convert `[[slug]]` tokens into standard markdown links targeting
 * `/wiki?page=slug`. Safe to apply to any markdown string — the regex
 * is tight enough to leave unrelated content alone.
 */
export function transformWikiLinks(content: string): string {
  // Each call gets its own stateful regex (the module-level `WIKI_LINK_RE`
  // carries `lastIndex` between calls because of the `g` flag).
  return content.replace(
    /\[\[([a-z0-9][a-z0-9-]{0,79})\]\]/gi,
    (_match, slug: string) => {
      const lower = slug.toLowerCase();
      return `[${prettifySlug(lower)}](${WIKI_LINK_HREF_PREFIX}${encodeURIComponent(lower)})`;
    },
  );
}

/** Return the slug if `href` is a wiki link, otherwise null. */
export function wikiSlugFromHref(href: string | null | undefined): string | null {
  if (!href) return null;
  if (!href.startsWith(WIKI_LINK_HREF_PREFIX)) return null;
  try {
    return decodeURIComponent(href.slice(WIKI_LINK_HREF_PREFIX.length)) || null;
  } catch {
    return null;
  }
}

/** Extract deduped, lowercased slugs from markdown content. */
export function extractWikiLinkSlugs(content: string): string[] {
  const out = new Set<string>();
  const re = /\[\[([a-z0-9][a-z0-9-]{0,79})\]\]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    out.add(m[1].toLowerCase());
  }
  return [...out];
}
