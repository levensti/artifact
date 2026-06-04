/**
 * Client-side "research thread" links for Discover.
 *
 * A follow-up question continues an earlier investigation, but each run still
 * persists as its own independent `DiscoverQuery` row (no schema change). To
 * render follow-ups nested under the brief they refine, we keep a small
 * localStorage map of `childQueryId → parentQueryId` and group by it in the
 * view layer. Purely presentational — losing it just un-nests the threads.
 */

import { DISCOVER_UPDATED_EVENT } from "@/lib/storage-events";
import type { DiscoverQuery, Recommendation } from "@/lib/discover-types";

const STORAGE_KEY = "artifact-discover-threads";

type ThreadMap = Record<string, string>; // childId -> parentId

function read(): ThreadMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as ThreadMap) : {};
  } catch {
    return {};
  }
}

function write(map: ThreadMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* quota / disabled storage — threading is best-effort */
  }
}

/** Record that `childId` is a follow-up of `parentId`. */
export function linkThread(childId: string, parentId: string): void {
  if (!childId || !parentId || childId === parentId) return;
  const map = read();
  if (map[childId] === parentId) return;
  map[childId] = parentId;
  write(map);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(DISCOVER_UPDATED_EVENT));
  }
}

/** The id of the brief this query follows up on, if any. */
export function getThreadParent(childId: string): string | null {
  return read()[childId] ?? null;
}

/**
 * Group queries into threads. Returns the root briefs (newest first, as
 * given) each with their follow-up children in chronological order. A child
 * whose parent is missing from `queries` is promoted to a root so nothing is
 * dropped.
 */
export interface QueryThread {
  root: DiscoverQuery;
  followups: DiscoverQuery[];
}

export function groupIntoThreads(queries: DiscoverQuery[]): QueryThread[] {
  const map = read();
  const byId = new Map(queries.map((q) => [q.id, q]));
  const childrenOf = new Map<string, DiscoverQuery[]>();
  const roots: DiscoverQuery[] = [];

  for (const q of queries) {
    const parentId = map[q.id];
    if (parentId && byId.has(parentId)) {
      const list = childrenOf.get(parentId) ?? [];
      list.push(q);
      childrenOf.set(parentId, list);
    } else {
      roots.push(q);
    }
  }

  const byCreatedAsc = (a: DiscoverQuery, b: DiscoverQuery) =>
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();

  return roots.map((root) => ({
    root,
    followups: (childrenOf.get(root.id) ?? []).slice().sort(byCreatedAsc),
  }));
}

/**
 * Build the prompt for a follow-up run. Gives the agent the prior question and
 * its top picks as context so it continues the investigation instead of
 * starting over.
 */
export function buildFollowupPrompt(
  parent: DiscoverQuery,
  picks: Recommendation[],
  followupText: string,
): string {
  const top = picks
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 4)
    .map((p) => `- ${p.title}${p.arxivId ? ` (arXiv:${p.arxivId})` : ""}`);

  const lines = [
    `This is a follow-up to an earlier research question: "${parent.query}".`,
  ];
  if (top.length > 0) {
    lines.push("", "Earlier I recommended:", ...top);
  }
  lines.push(
    "",
    `Follow-up: ${followupText.trim()}`,
    "",
    "Build on the earlier findings — go deeper or adjust as the follow-up asks, and avoid repeating papers already recommended above unless they're directly relevant.",
  );
  return lines.join("\n");
}
