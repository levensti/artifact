import "server-only";
import { BUILTIN_PROVIDER_ORDER, type Provider } from "@/lib/models";

/**
 * Platform-key fallback.
 *
 * When a signed-in user has not saved their own key for a built-in provider,
 * the AI route handlers fall back to a platform key read from the
 * environment. This keeps new users out of the "bring your own key" friction
 * while leaving existing key-bringers untouched.
 *
 * Hard rules:
 *   - This module is server-only. The env value MUST NOT reach the browser.
 *     Routes that serialize settings (`/api/bootstrap`, `/api/settings`) may
 *     surface ONLY the booleans from `platformProviderAvailability()` —
 *     never the key itself.
 *   - Fallback is opt-in by deployment: it activates only when the matching
 *     env var is set. Leave the vars unset to disable it entirely.
 *   - Inference profiles (`openai_compatible`) get no platform fallback —
 *     they're user-defined endpoints, not a provider we hold a key for.
 */

/** Built-in providers eligible for an env fallback. */
export type PlatformProvider = "anthropic" | "openai" | "xai";

const PLATFORM_ENV_VAR: Record<PlatformProvider, string> = {
  anthropic: "PROVIDED_ANTHROPIC_API_KEY",
  openai: "PROVIDED_OPENAI_API_KEY",
  xai: "PROVIDED_XAI_API_KEY",
};

function isPlatformProvider(p: Provider): p is PlatformProvider {
  return p === "anthropic" || p === "openai" || p === "xai";
}

/**
 * The platform key for a provider, or null when unconfigured. Reads
 * `process.env` on every call so deploys can rotate without a rebuild.
 */
export function platformKeyFor(provider: Provider): string | null {
  if (!isPlatformProvider(provider)) return null;
  const raw = process.env[PLATFORM_ENV_VAR[provider]];
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed ? trimmed : null;
}

/**
 * Resolve the key a route handler should use upstream: the caller's inline
 * key when present, otherwise the platform fallback, otherwise null (the
 * caller surfaces a 401). Never returns the env value to anything that
 * serializes to the client — handlers only pass it to `fetch`.
 */
export function resolveServerApiKey(
  provider: Provider,
  inlineKey: string | null | undefined,
): string | null {
  const trimmed = typeof inlineKey === "string" ? inlineKey.trim() : "";
  if (trimmed) return trimmed;
  return platformKeyFor(provider);
}

/**
 * Per-provider booleans indicating whether a platform fallback is
 * configured. Safe to send to the client — leaks existence only, never
 * the key. Inference-compatible providers are always false.
 */
export function platformProviderAvailability(): Record<Provider, boolean> {
  const out = {} as Record<Provider, boolean>;
  for (const p of BUILTIN_PROVIDER_ORDER) {
    out[p] = platformKeyFor(p) !== null;
  }
  out.openai_compatible = false;
  return out;
}
