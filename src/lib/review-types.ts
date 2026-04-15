import type { ArxivSearchResult } from "@/lib/explore";

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
