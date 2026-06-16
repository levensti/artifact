import type { Recipe } from "./types";

/**
 * Prompt slots for the research-assistant recipe. Generation reads the
 * `system` slot; the constant keeps call sites free of stringly-typed keys.
 */
export const RESEARCH_ASSISTANT_PROMPTS = {
  system: "system",
} as const;

/**
 * The recipe behind the app's `generate()` entrypoint (src/server/generate.ts):
 * a generic research assistant that answers a single prompt about a paper. This
 * is the system-under-test the ELAIPBench eval exercises, so its prompt lives
 * here, versioned, rather than inline in the entrypoint.
 */
export const researchAssistantRecipe: Recipe = {
  name: "research-assistant",
  description:
    "Generic single-turn research assistant used by generate(); answers a " +
    "prompt about an optionally-supplied paper.",
  prompts: {
    [RESEARCH_ASSISTANT_PROMPTS.system]: `You are an expert AI research assistant helping a researcher understand an academic paper. Return only the content requested by the user prompt.

When asked to output JSON:
- Return valid JSON only
- Do not include markdown fences
- Do not include extra commentary`,
  },
};
