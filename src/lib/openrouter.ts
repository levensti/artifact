/**
 * OpenRouter serves ONLY podcast text-to-speech: its `/audio/speech` endpoint
 * fronts Gemini-class TTS models Fireworks doesn't offer, always on the
 * platform `OPENROUTER_API_KEY`. Every chat completion goes to Fireworks
 * instead (see `@/lib/fireworks`).
 *
 * Server-only: it reads secrets-adjacent config and must never be bundled to
 * the browser.
 */

import "server-only";

/** OpenRouter's OpenAI-compatible base URL (no trailing slash). TTS only. */
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * The OpenRouter model id used for podcast text-to-speech, from the required
 * `PODCAST_TTS_MODEL` env var. No fallback and no hardcoded model — a missing
 * value throws so the misconfiguration surfaces immediately rather than
 * silently routing to a wrong or unintended TTS model. Kept out of code so the
 * chosen model is a deploy-time decision, swappable like `OPENROUTER_MODEL`.
 * Server-only; never reaches the browser.
 */
export function getPodcastTtsModel(): string {
  const raw = process.env.PODCAST_TTS_MODEL?.trim();
  if (!raw) {
    throw new Error("Missing required env var PODCAST_TTS_MODEL");
  }
  return raw;
}

/**
 * Whether podcast TTS is configured: a TTS model AND the platform OpenRouter
 * key that pays for it (TTS never uses a per-user key). Safe to send to the
 * client — leaks existence only, never the values. The Media tab uses this to
 * gate the Generate action so an unconfigured deploy shows a disabled state
 * instead of failing at generation time.
 */
export function podcastTtsAvailable(): boolean {
  return (
    !!process.env.PODCAST_TTS_MODEL?.trim() &&
    !!process.env.OPENROUTER_API_KEY?.trim()
  );
}
