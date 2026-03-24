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
