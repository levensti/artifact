import { PROVIDER_ORDER, type Provider } from "./models";

const STORAGE_PREFIX = "paper-copilot-key-";

/** Fired on same tab after set/clear so UI can refresh key presence. */
export const KEYS_UPDATED_EVENT = "paper-copilot-keys-updated";

function notifyKeysUpdated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(KEYS_UPDATED_EVENT));
}

export function getApiKey(provider: Provider): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(`${STORAGE_PREFIX}${provider}`);
}

/** True if the user has saved at least one provider key (models load only after this). */
export function hasAnySavedApiKey(): boolean {
  if (typeof window === "undefined") return false;
  return PROVIDER_ORDER.some((p) => !!localStorage.getItem(`${STORAGE_PREFIX}${p}`));
}

export function setApiKey(provider: Provider, key: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(`${STORAGE_PREFIX}${provider}`, key);
  notifyKeysUpdated();
}

export function clearApiKey(provider: Provider): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(`${STORAGE_PREFIX}${provider}`);
  notifyKeysUpdated();
}

