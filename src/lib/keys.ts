import {
  clearApiKey as clearApiKeyRemote,
  getApiKey as getApiKeyCached,
  getSavedSelectedModel as getSavedSelectedModelCached,
  hasAnySavedApiKey as hasAnySavedApiKeyCached,
  saveSelectedModel as saveSelectedModelRemote,
  setApiKey as setApiKeyRemote,
} from "@/lib/client-data";

export { KEYS_UPDATED_EVENT } from "@/lib/storage-events";

export function getApiKey(provider: import("./models").Provider): string | null {
  return getApiKeyCached(provider);
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
