export interface DeepDiveSession {
  id: string;
  reviewId: string;
  paperTitle: string;
  arxivId: string;
  topic: string;
  explanation: string;
  createdAt: string;
}

const DEEP_DIVES_KEY = "paper-copilot-deep-dives";
export const DEEP_DIVES_UPDATED_EVENT = "paper-copilot-deep-dives-updated";

function notifyDeepDivesUpdated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(DEEP_DIVES_UPDATED_EVENT));
}

export function getDeepDives(): DeepDiveSession[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(DEEP_DIVES_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as DeepDiveSession[];
  } catch {
    return [];
  }
}

export function saveDeepDive(
  payload: Omit<DeepDiveSession, "id" | "createdAt">,
): DeepDiveSession {
  const next: DeepDiveSession = {
    ...payload,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  const list = getDeepDives();
  list.unshift(next);
  localStorage.setItem(DEEP_DIVES_KEY, JSON.stringify(list));
  notifyDeepDivesUpdated();
  return next;
}
