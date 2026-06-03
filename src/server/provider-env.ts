import "server-only";

/**
 * OpenRouter key resolution + tool-key availability.
 *
 * The app calls exactly one provider (OpenRouter). A signed-in user may save
 * their own OpenRouter key; otherwise the route handlers fall back to a
 * platform key read from `OPENROUTER_API_KEY` in the environment.
 *
 * Hard rules:
 *   - This module is server-only. The env value MUST NOT reach the browser.
 *     Routes that serialize settings (`/api/bootstrap`, `/api/settings`) may
 *     surface ONLY the boolean from `platformOpenRouterAvailable()` — never
 *     the key itself.
 *   - The fallback activates only when `OPENROUTER_API_KEY` is set.
 */

function envOpenRouterKey(): string | null {
  const raw = process.env.OPENROUTER_API_KEY;
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed ? trimmed : null;
}

/**
 * Resolve the key a route handler should use upstream: the caller's inline
 * key when present, otherwise the platform fallback, otherwise null (the
 * caller surfaces a 401). Never returns the env value to anything that
 * serializes to the client — handlers only pass it to `fetch`.
 */
export function resolveOpenRouterKey(
  inlineKey: string | null | undefined,
): string | null {
  const trimmed = typeof inlineKey === "string" ? inlineKey.trim() : "";
  if (trimmed) return trimmed;
  return envOpenRouterKey();
}

/**
 * Whether a platform OpenRouter key is configured. Safe to send to the
 * client — leaks existence only, never the key.
 */
export function platformOpenRouterAvailable(): boolean {
  return envOpenRouterKey() !== null;
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
