/**
 * Shared paper-block construction for both chat handlers.
 *
 * The chat handlers receive either `paperContext` (full text) or
 * `parsedPaper` (structured summary + ToC). They build different `<paper>`
 * blocks for each mode so the model knows what's in context and which
 * tools to use.
 */

import type { ParsedPaper } from "@/lib/review-types";

/**
 * Build the `<paper>` block injected into the system prompt.
 *
 * - When `parsedPaper` is present: includes title, abstract, L1 summary,
 *   and a numbered table of contents. Sections themselves are accessed on
 *   demand via tools.
 * - Otherwise, when `paperContext` is present: includes the full extracted
 *   text. Backwards-compatible with the pre-Phase-3 behavior.
 * - Returns null when no paper is available — caller skips the block.
 */
export function buildPaperBlock(
  paperContext: string | undefined,
  parsedPaper: ParsedPaper | undefined,
): string | null {
  if (parsedPaper) {
    const tocLines = parsedPaper.sections.map(
      (s, i) =>
        `[${i}] ${"  ".repeat(Math.max(0, s.level - 1))}${s.heading}` +
        (s.startPage ? ` (p. ${s.startPage})` : ""),
    );

    const refCount = parsedPaper.references.length;
    const figCount = parsedPaper.figures.length;
    const refsNote = refCount
      ? `\nThe paper has ${refCount} references; resolve any with \`lookup_citation\`.`
      : "";
    const figsNote = figCount ? ` It has ${figCount} figures/tables.` : "";

    const parts: string[] = ["<paper>"];
    if (parsedPaper.title) parts.push(`<title>${parsedPaper.title}</title>`);
    if (parsedPaper.abstract)
      parts.push(`<abstract>\n${parsedPaper.abstract}\n</abstract>`);
    if (parsedPaper.summary)
      parts.push(`<summary>\n${parsedPaper.summary}\n</summary>`);
    parts.push(
      `<table_of_contents>\n${tocLines.join("\n")}\n</table_of_contents>`,
    );
    parts.push(
      `<note>You have only the summary and ToC above. Use \`read_section\` or \`search_paper\` for section bodies.${refsNote}${figsNote}</note>`,
    );
    parts.push("</paper>");
    return parts.join("\n");
  }

  if (paperContext) {
    return `<paper>\n${paperContext}\n</paper>`;
  }

  return null;
}
