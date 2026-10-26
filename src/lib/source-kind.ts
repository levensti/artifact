/**
 * What kind of thing a review is reading. Drives wording in the UI and the
 * reading agent's prompt so a filing, a blog post and an arXiv paper aren't
 * all called "the paper".
 */
export type SourceKind = "paper" | "document" | "web";

export function sourceKindOf(source: {
  arxivId?: string | null;
  sourceUrl?: string | null;
}): SourceKind {
  if (source.sourceUrl) return "web";
  if (source.arxivId) return "paper";
  return "document";
}

/** The noun to use in copy: "the paper", "the document", "the page". */
export function sourceNoun(kind: SourceKind): "paper" | "document" | "page" {
  return kind === "paper" ? "paper" : kind === "web" ? "page" : "document";
}
