import { Provider } from "./models";

const STORAGE_PREFIX = "paper-copilot-key-";

export function getApiKey(provider: Provider): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(`${STORAGE_PREFIX}${provider}`);
}

export function setApiKey(provider: Provider, key: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(`${STORAGE_PREFIX}${provider}`, key);
}

export function clearApiKey(provider: Provider): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(`${STORAGE_PREFIX}${provider}`);
}

