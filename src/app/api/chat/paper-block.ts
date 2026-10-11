/**
 * The `<paper>` block injected into the reading agent's system prompt.
 *
 * Three shapes, decided by the caller from the document's size and index
 * state:
 *   - full:      the whole text (short documents),
 *   - retrieval: passages retrieved for this turn plus the table of
 *                contents from the section tree (long, indexed documents),
 *   - partial:   a leading slice of the text with a note (long documents
 *                still indexing), so chat degrades instead of blocking.
 */

export interface PaperBlockInput {
  /** Full (or partial) text to inject verbatim. */
  text?: string;
  /** Retrieved passages for this turn (already formatted). */
  retrieved?: string | null;
  title?: string;
  /** One heading per line, "§1.2 Title (p. 8)", indented by depth. */
  tableOfContents?: string;
  /** Appended inside the block when set (e.g. "still indexing"). */
  note?: string;
}

export function buildPaperBlock(input: PaperBlockInput | undefined): string | null {
  if (!input) return null;
  const { text, retrieved, title, tableOfContents, note } = input;
  const parts: string[] = [];

  if (title) parts.push(`<title>${title}</title>`);

  if (text) {
    parts.push(text);
  } else if (retrieved !== undefined) {
    if (tableOfContents) {
      parts.push(`<table_of_contents>\n${tableOfContents}\n</table_of_contents>`);
    }
    parts.push(
      retrieved
        ? `<retrieved_passages>\n${retrieved}\n</retrieved_passages>`
        : `<retrieved_passages>\n(no passages matched this question)\n</retrieved_passages>`,
    );
    parts.push(
      "<note>This is a long document. The passages above were retrieved for the current question and are ordered as they appear in the document, grouped under their section heading, each with its page range. Cite sections ONLY by the § number shown in those headings; if a heading has no number, cite the page instead (\"(p. 12)\") and name the section in prose. Never invent a section number. Use `search_paper` to retrieve more passages for a different angle or for parts of the document not shown.</note>",
    );
  }

  if (note) parts.push(`<note>${note}</note>`);
  if (parts.length === 0) return null;
  return `<paper>\n${parts.join("\n")}\n</paper>`;
}
