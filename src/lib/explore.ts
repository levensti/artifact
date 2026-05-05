import type { Provider } from "./models";

/** Same as chat/generate API providers — kept as alias for explore/generation call sites. */
export type ExploreProvider = Provider;

export interface GenerateRequest {
  model: string;
  provider: ExploreProvider;
  /** Required. Sent inline from the browser. */
  apiKey: string;
  /** Base URL for OpenAI-compatible providers. */
  apiBaseUrl?: string;
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
