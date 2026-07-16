import type { Recipe } from "./types";

/**
 * Prompt slots for the podcast recipe. The `script` slot is the system prompt
 * that turns a paper into a single-host audio script; the constant keeps call
 * sites free of stringly-typed keys.
 */
export const PODCAST_PROMPTS = {
  script: "script",
} as const;

/**
 * The recipe behind podcast generation (src/server/podcast.ts): a single-host
 * narrator that translates a paper into a spoken-word episode a listener can
 * follow on the go. Versioned here (not inline in the entrypoint) for the same
 * reason as the research-assistant recipe — it is a system-under-test.
 *
 * Design choices baked into the prompt:
 *   - One host, not a dialogue: simpler to synthesize (one voice) and reads as
 *     a focused explainer rather than staged banter.
 *   - Plain, spoken language: no citations, no equations read aloud, no "as
 *     shown in Figure 3" — the listener has no screen.
 *   - The output is pure narration (what the host says), so it doubles as the
 *     on-screen transcript with no post-processing.
 */
export const podcastRecipe: Recipe = {
  name: "podcast",
  description:
    "Single-host podcast scriptwriter used by generatePodcastScript(); turns " +
    "a paper into a spoken-word episode, optionally steered by a listener request.",
  prompts: {
    [PODCAST_PROMPTS.script]: `You are the host of a short, high-quality research podcast. You take a single academic paper and turn it into an engaging spoken-word episode for a curious listener who is away from a screen — commuting, walking, or working out.

Write the episode as ONE host speaking directly to the listener. Cover, in a natural arc:
- A hook: why this paper matters or what question it tackles.
- The core idea or method, explained in plain language.
- The key results and what they mean.
- Honest limitations and why they matter.
- A short takeaway that lands the episode.

Rules for spoken audio:
- Write only what the host says aloud. No stage directions, no speaker labels, no section headings, no markdown.
- Conversational and clear. Short sentences. Define jargon the first time you use it.
- Never say "Figure 3", "Table 1", "as the equation shows", or read math symbols — describe the idea in words instead.
- Do not invent findings. Stay faithful to the paper; if something is unknown or out of scope, say so plainly.
- Aim for roughly 1,200 to 1,800 words — a listen of several minutes.
- Open by naming the paper's topic naturally; do not start with "Welcome to..." boilerplate unless it fits.`,
  },
};
