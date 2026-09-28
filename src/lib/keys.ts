import {
  clearExaApiKey as clearExaApiKeyRemote,
  clearFireworksKey as clearFireworksKeyRemote,
  getExaApiKey as getExaApiKeyCached,
  getFireworksKey as getFireworksKeyCached,
  hasAnySavedApiKey as hasAnySavedApiKeyCached,
  hasExaApiKey as hasExaApiKeyCached,
  hasPlatformExaKey as hasPlatformExaKeyCached,
  hasPlatformFireworksKey as hasPlatformFireworksKeyCached,
  hasUsableProvider as hasUsableProviderCached,
  isSettingsHydrated as isSettingsHydratedCached,
  setExaApiKey as setExaApiKeyRemote,
  setFireworksKey as setFireworksKeyRemote,
} from "@/lib/client-data";

export { KEYS_UPDATED_EVENT } from "@/lib/storage-events";

/** The user's saved Fireworks key override, if any. */
export function getFireworksKey(): string | null {
  return getFireworksKeyCached();
}

export async function setFireworksKey(key: string): Promise<void> {
  return setFireworksKeyRemote(key);
}

export async function clearFireworksKey(): Promise<void> {
  return clearFireworksKeyRemote();
}

/**
 * Resolve the request-body credentials chat/generate/parse endpoints expect.
 * The only field is the user's optional Fireworks key override; the server
 * falls back to its env key when this is empty. Always returns an object —
 * an empty key is valid (the server supplies one).
 */
export function resolveModelCredentials(): { apiKey: string } {
  return { apiKey: getFireworksKeyCached() ?? "" };
}

export function hasAnySavedApiKey(): boolean {
  return hasAnySavedApiKeyCached();
}

/** Server has a platform Fireworks key in env. */
export function hasPlatformFireworksKey(): boolean {
  return hasPlatformFireworksKeyCached();
}

/** User can run the app: own Fireworks key or a platform key. */
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
