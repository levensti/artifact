import { loadExplore } from "@/lib/client-data";

/** Short summary for the chat system prompt so the assistant can reference learning progress. */
export async function buildLearningContextSummary(
  reviewId: string,
): Promise<string> {
  const { prerequisites: p } = await loadExplore(reviewId);
  const parts: string[] = [];
  if (p?.prerequisites?.length) {
    const done = p.prerequisites.filter((x) => x.completedAt).length;
    parts.push(
      `Pre-reading: ${done}/${p.prerequisites.length} marked as read.`,
    );
    parts.push(`Topics: ${p.prerequisites.map((x) => x.topic).join("; ")}`);
  }
  return parts.join("\n");
}
