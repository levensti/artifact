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
    // Include difficulty and completion status per topic so the assistant
    // can tailor explanations to the reader's current level.
    const topicDetails = p.prerequisites.map((x) => {
      const status = x.completedAt ? "✓" : "○";
      return `${status} ${x.topic} (${x.difficulty})`;
    });
    parts.push(`Topics:\n${topicDetails.join("\n")}`);
  }
  if (g?.nodes?.length) {
    const edgeSummaries = g.edges.slice(0, 6).map(
      (e) => `  ${e.relationship}: ${g.nodes.find((n) => n.id === e.target)?.title ?? e.target}`,
    );
    parts.push(
      `Related-works map: ${g.nodes.length} papers, ${g.edges.length} links.`,
    );
    if (edgeSummaries.length > 0) {
      parts.push(`Key connections:\n${edgeSummaries.join("\n")}`);
    }
  }
  return parts.join("\n");
}
