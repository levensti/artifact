/**
 * Plain-text excerpt for share-link unfurls and landing pages.
 *
 * Strips markdown formatting and `[[wiki-links]]` so the snippet looks
 * good in Slack/Twitter previews where the renderer shows raw text.
 * Crude regex-based — good enough for a typical journal entry, not a
 * full markdown parser.
 */
export function extractExcerpt(content: string, maxChars: number): string {
  const cleaned = content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, slug, alias) => alias ?? slug)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_>~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= maxChars) return cleaned;
  // Hard-cut at last whitespace boundary so we don't slice mid-word —
  // unless the boundary is too far back, in which case mid-word is
  // visually fine after the ellipsis.
  const cut = cleaned.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut) + "…";
}
