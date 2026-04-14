/**
 * Shared utility for turning `[[slug]]` wiki-reference syntax into a
 * normal markdown link that the assistant, chat UI, and wiki browse
 * view can all render identically.
 *
 * The downstream markdown renderer detects these links by their href
 * prefix and attaches hover previews.
 */

const WIKI_LINK_RE = /\[\[([a-z0-9][a-z0-9-]{0,79})\]\]/gi;

export const WIKI_LINK_HREF_PREFIX = "/wiki?page=";

/**
 * Convert `[[slug]]` tokens into standard markdown links targeting
 * `/wiki?page=slug`. Safe to apply to any markdown string — the regex
 * is tight enough to leave unrelated content alone.
 */
export function transformWikiLinks(content: string): string {
  return content.replace(WIKI_LINK_RE, (_match, slug: string) => {
    const lower = slug.toLowerCase();
    return `[${lower}](${WIKI_LINK_HREF_PREFIX}${encodeURIComponent(lower)})`;
  });
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
