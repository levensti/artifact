import { getGraphData, getPrerequisites } from "@/lib/explore";

/** Short summary for the chat system prompt so the assistant can reference learning progress. */
export function buildLearningContextSummary(reviewId: string): string {
  const p = getPrerequisites(reviewId);
  const g = getGraphData(reviewId);
  const parts: string[] = [];
  if (p?.prerequisites?.length) {
    const done = p.prerequisites.filter((x) => x.completedAt).length;
    parts.push(
      `Pre-reading: ${done}/${p.prerequisites.length} marked as read.`,
    );
    parts.push(
      `Topics: ${p.prerequisites.map((x) => x.topic).join("; ")}`,
    );
  }
  if (g?.nodes?.length) {
    parts.push(
      `Related-works map for this review: ${g.nodes.length} papers (${g.edges.length} typed links).`,
    );
  }
  return parts.join("\n");
}
