/** Machine-readable signal at end of assistant text; stripped before display. Client runs the learning map pipeline when present. */
export const LEARNING_MAP_SENTINEL = "[[paper-copilot:learning-map]]";

export function stripLearningMapSentinel(content: string): {
  text: string;
  shouldRunLearningMap: boolean;
} {
  if (!content.includes(LEARNING_MAP_SENTINEL)) {
    return { text: content, shouldRunLearningMap: false };
  }
  const text = content
    .split(LEARNING_MAP_SENTINEL)
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
  return { text, shouldRunLearningMap: true };
}
