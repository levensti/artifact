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
}

export interface Prerequisite {
  id: string;
  topic: string;
  description: string;
  difficulty: "foundational" | "intermediate" | "advanced";
  explanation?: string;
  /** ISO timestamp when the user marked this prerequisite as addressed */
  completedAt?: string;
}

export interface PrerequisitesData {
  prerequisites: Prerequisite[];
  generatedAt: string;
  modelUsed: string;
}

export interface ArxivSearchResult {
  arxivId: string;
  title: string;
  authors: string[];
  abstract: string;
  publishedDate: string;
  categories: string[];
}

export { EXPLORE_UPDATED_EVENT } from "@/lib/storage-events";
