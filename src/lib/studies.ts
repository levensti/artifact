export interface Study {
  id: string;
  title: string;
  arxivId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

const STUDIES_KEY = "paper-copilot-studies";
const MESSAGES_KEY_PREFIX = "paper-copilot-messages-";

export function getStudies(): Study[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(STUDIES_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Study[];
  } catch {
    return [];
  }
}

export function getStudy(id: string): Study | undefined {
  return getStudies().find((s) => s.id === id);
}

export function createStudy(arxivId: string, title: string): Study {
  const study: Study = {
    id: crypto.randomUUID(),
    title,
    arxivId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const studies = getStudies();
  studies.unshift(study);
  localStorage.setItem(STUDIES_KEY, JSON.stringify(studies));
  return study;
}

export function updateStudy(id: string, updates: Partial<Pick<Study, "title" | "updatedAt">>): void {
  const studies = getStudies();
  const idx = studies.findIndex((s) => s.id === id);
  if (idx === -1) return;
  studies[idx] = { ...studies[idx], ...updates, updatedAt: new Date().toISOString() };
  localStorage.setItem(STUDIES_KEY, JSON.stringify(studies));
}

export function deleteStudy(id: string): void {
  const studies = getStudies().filter((s) => s.id !== id);
  localStorage.setItem(STUDIES_KEY, JSON.stringify(studies));
  localStorage.removeItem(`${MESSAGES_KEY_PREFIX}${id}`);
}

export function getMessages(studyId: string): ChatMessage[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(`${MESSAGES_KEY_PREFIX}${studyId}`);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as ChatMessage[];
  } catch {
    return [];
  }
}

export function saveMessages(studyId: string, messages: ChatMessage[]): void {
  localStorage.setItem(`${MESSAGES_KEY_PREFIX}${studyId}`, JSON.stringify(messages));
}
