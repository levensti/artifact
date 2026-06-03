export interface GenerateRequest {
  /** Optional per-user OpenRouter key override. Server falls back to env. */
  apiKey?: string;
  prompt: string;
  paperContext?: string;
  /** When true, response is streamed as text/plain text deltas. */
  stream?: boolean;
}

export interface ArxivSearchResult {
  arxivId: string;
  title: string;
  authors: string[];
  abstract: string;
  publishedDate: string;
  categories: string[];
}
