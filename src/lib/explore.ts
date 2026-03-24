export type ExploreProvider = "anthropic" | "openai" | "openrouter";

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
  | "contrasts-with"
  | "surveys";

/** Short labels for graph edges / legend */
export const RELATIONSHIP_SHORT_LABEL: Record<RelationshipType, string> = {
  prerequisite: "Prereq",
  "builds-upon": "Builds on",
  extends: "Follow-on",
  "similar-approach": "Similar",
  "contrasts-with": "Contrasts",
  surveys: "Survey",
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

const GLOBAL_GRAPH_KEY = "paper-copilot-knowledge-graph";

function edgeKeyDirected(e: GraphEdge): string {
  return `${e.source}→${e.target}:${e.relationship}`;
}

/** Merge a session graph into the persistent knowledge map (all Explore sessions). */
export function mergeSessionGraphIntoGlobal(anchorReviewId: string, graph: GraphData): void {
  if (typeof window === "undefined") return;
  const existing =
    safeRead<GlobalGraphData>(GLOBAL_GRAPH_KEY) ??
    ({
      nodes: [],
      edges: [],
      updatedAt: new Date().toISOString(),
    } satisfies GlobalGraphData);

  const nodeByArxiv = new Map<string, GraphNode>();
  for (const n of existing.nodes) {
    nodeByArxiv.set(n.arxivId, { ...n, id: n.arxivId, isCurrent: false });
  }

  for (const n of graph.nodes) {
    const merged: GraphNode = {
      ...n,
      id: n.arxivId,
      isCurrent: false,
    };
    const prev = nodeByArxiv.get(n.arxivId);
    if (
      !prev ||
      (merged.abstract?.length ?? 0) > (prev.abstract?.length ?? 0) ||
      (merged.title?.length ?? 0) > (prev.title?.length ?? 0)
    ) {
      nodeByArxiv.set(n.arxivId, merged);
    }
  }

  const edgeMap = new Map<string, GlobalGraphData["edges"][number]>();
  for (const e of existing.edges) {
    edgeMap.set(edgeKeyDirected(e), e);
  }

  for (const e of graph.edges) {
    const k = edgeKeyDirected(e);
    const prev = edgeMap.get(k);
    if (!prev) {
      edgeMap.set(k, { ...e, sourceReviewIds: [anchorReviewId] });
    } else if (!prev.sourceReviewIds.includes(anchorReviewId)) {
      edgeMap.set(k, {
        ...prev,
        reasoning: prev.reasoning.length >= e.reasoning.length ? prev.reasoning : e.reasoning,
        sourceReviewIds: [...prev.sourceReviewIds, anchorReviewId],
      });
    }
  }

  const next: GlobalGraphData = {
    nodes: [...nodeByArxiv.values()],
    edges: [...edgeMap.values()],
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(GLOBAL_GRAPH_KEY, JSON.stringify(next));
  notifyExploreUpdated();
}

export function getGlobalGraphData(): GlobalGraphData | null {
  return safeRead<GlobalGraphData>(GLOBAL_GRAPH_KEY);
}

export function globalGraphToGraphData(): GraphData | null {
  const g = getGlobalGraphData();
  if (!g || g.nodes.length === 0) return null;
  return {
    nodes: g.nodes,
    edges: g.edges.map(({ sourceReviewIds: _, ...e }) => e),
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

const PREREQ_KEY_PREFIX = "paper-copilot-prerequisites-";
const GRAPH_KEY_PREFIX = "paper-copilot-graph-";

export const EXPLORE_UPDATED_EVENT = "paper-copilot-explore-updated";

function safeRead<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function notifyExploreUpdated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(EXPLORE_UPDATED_EVENT));
}

export function getPrerequisites(reviewId: string): PrerequisitesData | null {
  return safeRead<PrerequisitesData>(`${PREREQ_KEY_PREFIX}${reviewId}`);
}

export function savePrerequisites(
  reviewId: string,
  prerequisites: PrerequisitesData,
): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    `${PREREQ_KEY_PREFIX}${reviewId}`,
    JSON.stringify(prerequisites),
  );
  notifyExploreUpdated();
}

export function getGraphData(reviewId: string): GraphData | null {
  return safeRead<GraphData>(`${GRAPH_KEY_PREFIX}${reviewId}`);
}

export function saveGraphData(reviewId: string, graph: GraphData): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(`${GRAPH_KEY_PREFIX}${reviewId}`, JSON.stringify(graph));
  notifyExploreUpdated();
}

export function clearExploreData(reviewId: string): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(`${PREREQ_KEY_PREFIX}${reviewId}`);
  localStorage.removeItem(`${GRAPH_KEY_PREFIX}${reviewId}`);
  notifyExploreUpdated();
}

export function clearGlobalKnowledgeGraph(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(GLOBAL_GRAPH_KEY);
  notifyExploreUpdated();
}
