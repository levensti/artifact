/**
 * Single source of truth for the LLM provider + model.
 *
 * The app talks to exactly one inference provider — OpenRouter, via its
 * OpenAI-compatible Chat Completions API — and one fixed model chosen by the
 * platform. Users don't pick a model: a fixed, vetted model keeps agent
 * quality attributable to Artifact rather than to whatever the user happened
 * to select. The OpenRouter API key comes from the `OPENROUTER_API_KEY` env
 * var, with an optional per-user override entered in Settings.
 */

import type { Model } from "@/lib/models";

/** OpenRouter's OpenAI-compatible base URL (no trailing slash). */
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** The single model every surface uses. OpenRouter model id. */
export const OPENROUTER_MODEL = "deepseek/deepseek-v4-flash";

/**
 * Conservative context-window estimate (tokens) for the fixed model, used by
 * the server's history-budgeting pass. Erring small only trims history a
 * little sooner — never an overflow.
 */
export const OPENROUTER_CONTEXT_WINDOW = 131_072;

/** The fixed model object, used everywhere a `selectedModel` is expected. */
export const FIXED_MODEL: Model = {
  id: OPENROUTER_MODEL,
  modelId: OPENROUTER_MODEL,
};
