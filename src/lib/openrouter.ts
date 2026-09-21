/**
 * Single source of truth for the LLM providers + model.
 *
 * The app talks to two inference providers, both via the OpenAI-compatible
 * API shapes:
 *   - Fireworks serves every chat completion (chat, generate, paper parsing,
 *     podcast scripts), with one fixed model chosen by the platform. Users
 *     don't pick a model: a fixed, vetted model keeps agent quality
 *     attributable to Artifact rather than to whatever the user happened to
 *     select. The platform key comes from `FIREWORKS_API_KEY`, with an
 *     optional per-user override entered in Settings.
 *   - OpenRouter serves ONLY podcast text-to-speech (its `/audio/speech`
 *     endpoint fronts Gemini-class TTS models Fireworks doesn't offer), always
 *     on the platform `OPENROUTER_API_KEY`.
 *
 * The model and its context window come from the environment, with no code
 * fallback: a misconfigured deploy fails loudly rather than silently routing
 * to a wrong model or budgeting against the wrong window. Both vars are
 * server-only (no `NEXT_PUBLIC_` prefix) and read lazily through the getters
 * below, so they throw at request time on the server and never force the
 * client bundle to carry the value:
 *   - `FIREWORKS_MODEL` is the model id. It drives routing on the server,
 *     where chat/generate paths default to `getFireworksModel()`, so a client
 *     never dictates the upstream model.
 *   - `FIREWORKS_MODEL_CONTEXT_WINDOW` is the token budget for history trimming.
 * Set both together when swapping models so the budget matches the new window.
 *
 * This module is server-only: it reads/validates secrets-adjacent config and
 * must never be bundled to the browser. The UI tracks readiness as a plain
 * boolean (`modelReady`, derived from `hasUsableProvider()`); it never needs a
 * model object.
 */

import "server-only";

/** Fireworks' OpenAI-compatible base URL (no trailing slash). Chat only. */
export const FIREWORKS_BASE_URL = "https://api.fireworks.ai/inference/v1";

/** OpenRouter's OpenAI-compatible base URL (no trailing slash). TTS only. */
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * The Fireworks model id every chat-completions surface routes to, from the
 * required `FIREWORKS_MODEL` env var. No fallback — a missing value throws so
 * the misconfiguration surfaces immediately. Server-only; never reaches the
 * browser.
 */
export function getFireworksModel(): string {
  const raw = process.env.FIREWORKS_MODEL?.trim();
  if (!raw) {
    throw new Error("Missing required env var FIREWORKS_MODEL");
  }
  return raw;
}

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

/**
 * Conservative context-window estimate (tokens) for the configured model, used
 * by the server's history-budgeting pass. Erring small only trims history a
 * little sooner, never an overflow. From the required `FIREWORKS_MODEL_CONTEXT_WINDOW`
 * env var; no fallback — a missing or non-positive value throws.
 */
export function getFireworksContextWindow(): number {
  const raw = process.env.FIREWORKS_MODEL_CONTEXT_WINDOW?.trim();
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(
      "Missing or invalid env var FIREWORKS_MODEL_CONTEXT_WINDOW (expected a positive integer)",
    );
  }
  return n;
}

/**
 * Token reserves carved out of the context window before history is allotted
 * its share (see the budgeting pass in `/api/chat`). Round numbers: these are
 * deliberate cushions, not measured limits.
 *
 *   RESPONSE  - space held back for the model's reply (output tokens).
 *   SAFETY    - slack for tokenizer drift between our estimate and the model's.
 *   HISTORY_FLOOR - minimum history sent even when overhead is large, so a
 *                   turn always carries some prior context.
 */
export const TOKEN_RESERVE = {
  RESPONSE: 16_000,
  SAFETY: 4_000,
  HISTORY_FLOOR: 4_000,
} as const;

/**
 * Fraction of the FULL context window at which the chat offers/auto-runs
 * compaction. Measured against the raw window (matching the usage the meter
 * shows), so "≥90%" means the same thing the user sees.
 */
export const COMPACT_THRESHOLD = 0.9;

/**
 * Whether a measured/estimated context size has crossed the compaction
 * threshold (a share of the full window). Single source of truth shared by the
 * chat stream, the messages GET, and the compaction endpoint so the client
 * never needs the threshold constant.
 */
export function computeShouldCompact(
  usedTokens: number,
  windowTokens: number,
): boolean {
  return windowTokens > 0 && usedTokens >= COMPACT_THRESHOLD * windowTokens;
}

/**
 * Token usage in the OpenAI-compatible chat-completions shape, as reported by
 * both providers (Fireworks for chat, OpenRouter for the podcast script's
 * sibling calls). Shared by every caller that meters spend; the caller decides
 * how to weight it. `total_tokens` is provided by the API but unused by our
 * metering. `prompt_tokens_details.cached_tokens` may be absent on providers
 * that don't report cache reads — callers already default it to 0.
 */
export interface OpenRouterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
}
