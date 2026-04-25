import type { Model } from "@/lib/models";
import { isInferenceProviderType } from "@/lib/models";
import { hasInferenceCredentials } from "@/lib/ai-providers";
import {
  clearApiKey as clearApiKeyRemote,
  getApiKey as getApiKeyCached,
  getInferenceProfile as getInferenceProfileCached,
  getInferenceProfiles as getInferenceProfilesCached,
  getSavedSelectedModel as getSavedSelectedModelCached,
  hasAnySavedApiKey as hasAnySavedApiKeyCached,
  isBuiltinProviderReady as isBuiltinProviderReadyCached,
  isModelReady as isModelReadyCached,
  isProviderReady as isProviderReadyCached,
  saveInferenceProfiles as saveInferenceProfilesRemote,
  saveSelectedModel as saveSelectedModelRemote,
  setApiKey as setApiKeyRemote,
} from "@/lib/client-data";

export { KEYS_UPDATED_EVENT } from "@/lib/storage-events";

export function getApiKey(provider: import("./models").Provider): string | null {
  return getApiKeyCached(provider);
}

export function getInferenceProfiles(): import("./models").InferenceProviderProfile[] {
  return getInferenceProfilesCached();
}

export function getInferenceProfile(
  id: string,
): import("./models").InferenceProviderProfile | undefined {
  return getInferenceProfileCached(id);
}

/** Credentials for chat/generate when using an inference profile. */
export function resolveInferenceCredentials(
  model: Model,
): { apiKey: string; baseUrl: string } | null {
  if (!isInferenceProviderType(model.provider) || !model.profileId) return null;
  const p = getInferenceProfileCached(model.profileId);
  if (!p || !hasInferenceCredentials(p)) return null;
  return { apiKey: p.apiKey?.trim() ?? "", baseUrl: p.baseUrl.trim() };
}

/**
 * Resolve the request-body fields chat/generate/models endpoints expect
 * for the given model. Works for both built-in providers (returns just
 * `apiKey`) and inference profiles (returns `apiKey`, `apiBaseUrl`, and
 * `supportsStreaming`). Returns null if the required credentials aren't
 * configured — the caller should surface a friendly error.
 *
 * Local inference profiles (localhost base URL) allow an empty `apiKey`
 * since runtimes like Ollama / LM Studio / llama.cpp don't use one. Cloud
 * inference profiles still require a key.
 */
export function resolveModelCredentials(
  model: Model,
): {
  apiKey: string;
  apiBaseUrl?: string;
  supportsStreaming?: boolean;
} | null {
  if (isInferenceProviderType(model.provider)) {
    if (!model.profileId) return null;
    const p = getInferenceProfileCached(model.profileId);
    if (!p || !hasInferenceCredentials(p)) return null;
    return {
      apiKey: p.apiKey?.trim() ?? "",
      apiBaseUrl: p.baseUrl.trim(),
      supportsStreaming: p.supportsStreaming !== false,
    };
  }
  const key = getApiKeyCached(model.provider);
  if (!key) return null;
  return { apiKey: key };
}

export function isBuiltinProviderReady(provider: import("./models").Provider): boolean {
  return isBuiltinProviderReadyCached(provider);
}

export function isModelReady(model: Model): boolean {
  return isModelReadyCached(model);
}

/** Built-in providers only (not inference). */
export function isProviderReady(provider: import("./models").Provider): boolean {
  return isProviderReadyCached(provider);
}

export function hasAnySavedApiKey(): boolean {
  return hasAnySavedApiKeyCached();
}

export async function setApiKey(
  provider: import("./models").Provider,
  key: string,
): Promise<void> {
  return setApiKeyRemote(provider, key);
}

export async function saveInferenceProfiles(
  profiles: import("./models").InferenceProviderProfile[],
): Promise<void> {
  return saveInferenceProfilesRemote(profiles);
}

export async function clearApiKey(
  provider: import("./models").Provider,
): Promise<void> {
  return clearApiKeyRemote(provider);
}

export async function saveSelectedModel(
  model: import("./models").Model | null,
): Promise<void> {
  return saveSelectedModelRemote(model);
}

export function getSavedSelectedModel(): import("./models").Model | null {
  return getSavedSelectedModelCached();
}

export { isInferenceProviderType } from "@/lib/models";
