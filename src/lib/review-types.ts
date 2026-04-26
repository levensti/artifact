import type { ArxivSearchResult } from "@/lib/explore";
import type { Provider } from "@/lib/models";

/** A text segment in an interleaved agent response. */
export interface TextSegmentBlock {
  type: "text_segment";
  content: string;
}

/** A tool invocation recorded in a chat message. */
export interface ToolCallBlock {
  type: "tool_call";
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: string;
}

/**
 * Structured content rendered in an assistant message.
 * For agentic responses, blocks are stored in display order (text_segment
 * interleaved with tool_call) so the interleaved view survives page reload.
 */
export type ChatAssistantBlock =
  | TextSegmentBlock
  | ToolCallBlock
  | { type: "learning_embed"; reviewId: string }
  | { type: "arxiv_hits"; query: string; results: ArxivSearchResult[] };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  /** Rich panels for learning / literature actions (assistant only). */
  blocks?: ChatAssistantBlock[];
}

/* ------------------------------------------------------------------ */
/*  Structured paper representation                                    */
/* ------------------------------------------------------------------ */

/**
 * A section of a parsed paper. Body text is the section's content
 * verbatim; level is 1 for top-level (Introduction) and 2/3 for nested.
 */
export interface ParsedSection {
  heading: string;
  level: number;
  body: string;
  startPage?: number;
}

/**
 * A bibliographic reference resolved from the paper's reference list.
 * Key matches the in-text citation form (e.g. "[27]" or "Vaswani2017").
 */
export interface ParsedReference {
  key: string;
  text: string;
  doi?: string;
  arxivId?: string;
}

/** A figure or table identified by caption. */
export interface ParsedFigure {
  id: string;
  caption: string;
  page?: number;
}

/**
 * Structured representation of a paper, produced by the parsing endpoint
 * and cached per content hash in IndexedDB. Used by section-aware tools
 * (read_section, search_paper, lookup_citation) and the L1-card chat
 * strategy for long papers.
 */
export interface ParsedPaper {
  title: string;
  abstract: string;
  sections: ParsedSection[];
  references: ParsedReference[];
  figures: ParsedFigure[];
  /**
   * 800-1500 word L1 paper card: central claim, methods, key results,
   * novelty, limitations. Always sent to the chat handler in long-paper
   * mode; sections are fetched on demand via tools.
   */
  summary: string;
  parsedAt: string;
  parsedWith: { provider: Provider; modelId: string };
}

/** A saved paper review session: PDF / web page + replayable Q&A. */
export interface PaperReview {
  id: string;
  title: string;
  /** arXiv paper ID. Null for locally-uploaded PDFs and web pages. */
  arxivId: string | null;
  createdAt: string;
  updatedAt: string;
  /** Absolute filesystem path for local PDFs. Null for arXiv papers and web pages. */
  pdfPath: string | null;
  /** Source URL for arbitrary web pages. Null for arXiv papers and local PDFs. */
  sourceUrl: string | null;
  /** ISO timestamp set when this review arrived via share-bundle import. Drives the sidebar "Imported" badge. */
  importedAt?: string;
}
