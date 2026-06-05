import type { Model } from "@/lib/models";
import {
  clearExaApiKey as clearExaApiKeyRemote,
  clearOpenRouterKey as clearOpenRouterKeyRemote,
  getExaApiKey as getExaApiKeyCached,
  getOpenRouterKey as getOpenRouterKeyCached,
  getSavedSelectedModel as getSavedSelectedModelCached,
  hasAnySavedApiKey as hasAnySavedApiKeyCached,
  hasExaApiKey as hasExaApiKeyCached,
  hasPlatformExaKey as hasPlatformExaKeyCached,
  hasPlatformOpenRouterKey as hasPlatformOpenRouterKeyCached,
  hasUsableProvider as hasUsableProviderCached,
  isSettingsHydrated as isSettingsHydratedCached,
  setExaApiKey as setExaApiKeyRemote,
  setOpenRouterKey as setOpenRouterKeyRemote,
} from "@/lib/client-data";

export { KEYS_UPDATED_EVENT } from "@/lib/storage-events";

/** The user's saved OpenRouter key override, if any. */
export function getOpenRouterKey(): string | null {
  return getOpenRouterKeyCached();
}

export async function setOpenRouterKey(key: string): Promise<void> {
  return setOpenRouterKeyRemote(key);
}

export async function clearOpenRouterKey(): Promise<void> {
  return clearOpenRouterKeyRemote();
}

/**
 * Resolve the request-body credentials chat/generate/parse endpoints expect.
 * The only field is the user's optional OpenRouter key override; the server
 * falls back to its env key when this is empty. Always returns an object —
 * an empty key is valid (the server supplies one).
 */
export function resolveModelCredentials(): { apiKey: string } {
  return { apiKey: getOpenRouterKeyCached() ?? "" };
}

export function hasAnySavedApiKey(): boolean {
  return hasAnySavedApiKeyCached();
}

/** Server has a platform OpenRouter key in env. */
export function hasPlatformOpenRouterKey(): boolean {
  return hasPlatformOpenRouterKeyCached();
}

/** User can run the app: own OpenRouter key or a platform key. */
export function hasUsableProvider(): boolean {
  return hasUsableProviderCached();
}

/**
 * Whether key/settings state has loaded yet. Before this, key state is
 * unknown (not "no keys") — used to suppress setup prompts until we know.
 */
export function isSettingsHydrated(): boolean {
  return isSettingsHydratedCached();
}

export function getExaApiKey(): string | null {
  return getExaApiKeyCached();
}

export function hasExaApiKey(): boolean {
  return hasExaApiKeyCached();
}

/** True when the server has EXA_API_KEY in env (booleans-only signal). */
export function hasPlatformExaKey(): boolean {
  return hasPlatformExaKeyCached();
}

/** Web search is usable: either the user has a key or the platform has one. */
export function hasUsableExaKey(): boolean {
  return hasExaApiKeyCached() || hasPlatformExaKeyCached();
}

export async function setExaApiKey(key: string): Promise<void> {
  return setExaApiKeyRemote(key);
}

export async function clearExaApiKey(): Promise<void> {
  return clearExaApiKeyRemote();
}

export function getSavedSelectedModel(): Model {
  return getSavedSelectedModelCached();
}
