import "server-only";

/**
 * Provider key resolution + tool-key availability.
 *
 * Two providers, two keys:
 *   - Fireworks pays for every chat completion. A signed-in user may save
 *     their own Fireworks key; otherwise the route handlers fall back to a
 *     platform key read from `FIREWORKS_API_KEY` in the environment.
 *   - OpenRouter pays ONLY for podcast text-to-speech, always via the
 *     platform `OPENROUTER_API_KEY` — there is no per-user TTS key.
 *
 * Hard rules:
 *   - This module is server-only. The env values MUST NOT reach the browser.
 *     Routes that serialize settings (`/api/bootstrap`, `/api/settings`) may
 *     surface ONLY the booleans from `platformFireworksAvailable()` /
 *     `platformOpenRouterAvailable()` — never a key itself.
 *   - A fallback activates only when its env var is set.
 */

function envKey(name: "FIREWORKS_API_KEY" | "OPENROUTER_API_KEY"): string | null {
  const raw = process.env[name];
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed ? trimmed : null;
}

/**
 * Resolve the Fireworks key a chat route handler should use upstream: the
 * caller's inline key when present, otherwise the platform fallback, otherwise
 * null (the caller surfaces a 401). Never returns the env value to anything
 * that serializes to the client — handlers only pass it to `fetch`.
 */
export function resolveFireworksKey(
  inlineKey: string | null | undefined,
): string | null {
  const trimmed = typeof inlineKey === "string" ? inlineKey.trim() : "";
  if (trimmed) return trimmed;
  return envKey("FIREWORKS_API_KEY");
}

/**
 * Whether a platform Fireworks key is configured. Safe to send to the
 * client — leaks existence only, never the key.
 */
export function platformFireworksAvailable(): boolean {
  return envKey("FIREWORKS_API_KEY") !== null;
}

/**
 * The platform OpenRouter key, used exclusively for podcast TTS. Null when
 * unset (the podcast route surfaces a clear error / the UI gates on the
 * availability boolean). Never a per-user key.
 */
export function platformOpenRouterKey(): string | null {
  return envKey("OPENROUTER_API_KEY");
}

/**
 * Whether a platform OpenRouter key is configured. Safe to send to the
 * client — leaks existence only, never the key.
 */
export function platformOpenRouterAvailable(): boolean {
  return envKey("OPENROUTER_API_KEY") !== null;
}

/**
 * Tool-key availability. Tool keys (currently just Exa) get their own
 * surface. Booleans only — the env key never reaches the browser.
 */
export interface PlatformToolAvailability {
  exa: boolean;
}

export function platformToolAvailability(): PlatformToolAvailability {
  return {
    exa: !!(process.env.EXA_API_KEY && process.env.EXA_API_KEY.trim()),
  };
}
