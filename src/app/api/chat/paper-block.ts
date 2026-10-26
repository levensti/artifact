/**
 * The `<source>` block injected into the reading agent's system prompt: the
 * document's table of contents plus the passages retrieved for this turn.
 * Chat reads every document through retrieval; the agent asks for more with
 * `search_paper`.
 */

export interface PaperBlockInput {
  /** Retrieved passages for this turn (already formatted), or null when
   *  nothing matched. */
  retrieved: string | null;
  title?: string;
  /** One heading per line, "§1.2 Title (p. 8)", indented by depth. */
  tableOfContents?: string;
}

export function buildPaperBlock(input: PaperBlockInput | undefined): string | null {
  if (!input) return null;
  const { retrieved, title, tableOfContents } = input;
  const parts: string[] = [];

  if (title) parts.push(`<title>${title}</title>`);
  if (tableOfContents) {
    parts.push(`<table_of_contents>\n${tableOfContents}\n</table_of_contents>`);
  }
  parts.push(
    retrieved
      ? `<retrieved_passages>\n${retrieved}\n</retrieved_passages>`
      : `<retrieved_passages>\n(no passages were retrieved for this message)\n</retrieved_passages>`,
  );
  parts.push(
    "<note>You see this document only through retrieval. The passages above were retrieved for the current message and are ordered as they appear in the document, grouped under their section heading, each with its page range. Cite sections ONLY by the § number shown in those headings; if a heading has no number, cite the page instead (\"(p. 12)\") and name the section in prose. Never invent a section number. Use `search_paper` to retrieve more passages for a different angle or for parts of the document not shown, and do so before answering whenever the passages don't cover what the user asked.</note>",
  );
  return `<source>\n${parts.join("\n")}\n</source>`;
}
