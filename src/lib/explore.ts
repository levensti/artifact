import type { Provider } from "./models";

/** Same as chat/generate API providers — kept as alias for explore/generation call sites. */
export type ExploreProvider = Provider;

export interface GenerateRequest {
  model: string;
  provider: ExploreProvider;
  apiKey: string;
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

export type RelationshipType =
  | "builds-upon"
  | "extends"
  | "similar-approach"
  | "prerequisite"
  | "contrasts-with";

/** Short labels for graph edges / legend */
export const RELATIONSHIP_SHORT_LABEL: Record<RelationshipType, string> = {
  prerequisite: "Prereq",
  "builds-upon": "Builds on",
  extends: "Follow-on",
  "similar-approach": "Similar",
  "contrasts-with": "Contrasts",
};

export interface GraphNode {
  id: string;
  title: string;
  authors: string[];
  abstract: string;
  arxivId: string;
  publishedDate: string;
  categories: string[];
  isCurrent: boolean;
}

export interface GraphEdge {
  source: string;
  target: string;
  relationship: RelationshipType;
  reasoning: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  keywords: string[];
  generatedAt: string;
  modelUsed: string;
  /** Review session that produced this map (for merged graph provenance) */
  anchorReviewId?: string;
}

/** Cross-review merged literature graph (nodes keyed by arXiv id). */
export interface GlobalGraphData {
  nodes: GraphNode[];
  edges: Array<
    GraphEdge & {
      sourceReviewIds: string[];
    }
  >;
  updatedAt: string;
}

export function globalGraphToGraphData(
  g: GlobalGraphData | null,
): GraphData | null {
  if (!g || g.nodes.length === 0) return null;
  return {
    nodes: g.nodes,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    edges: g.edges.map(({ sourceReviewIds, ...e }) => e),
    keywords: [],
    generatedAt: g.updatedAt,
    modelUsed: "merged",
  };
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
