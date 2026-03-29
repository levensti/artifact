import type { ChatAssistantBlock } from "@/lib/reviews";

/** Margin comment vs selection-based AI Q&A thread */
export type AnnotationKind = "comment" | "ask_ai";

export interface Annotation {
  id: string;
  reviewId: string;
  pageNumber: number;
  highlightText: string;
  anchorRects: { x: number; y: number; w: number; h: number }[];
  note: string;
  thread: AnnotationMessage[];
  kind: AnnotationKind;
  createdAt: string;
  updatedAt: string;
}

export interface AnnotationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  /** Learning map / arXiv panels (assistant only), same as main chat */
  blocks?: ChatAssistantBlock[];
}

const KEY_PREFIX = "paper-copilot-annotations-";
export const ANNOTATIONS_UPDATED_EVENT = "paper-copilot-annotations-updated";

function notify() {
  window.dispatchEvent(new Event(ANNOTATIONS_UPDATED_EVENT));
}

export function getAnnotations(reviewId: string): Annotation[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(`${KEY_PREFIX}${reviewId}`);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as Annotation[];
    return list.map((a) => ({
      ...a,
      kind: a.kind ?? "comment",
    }));
  } catch {
    return [];
  }
}

export function getAnnotation(
  reviewId: string,
  annotationId: string,
): Annotation | undefined {
  return getAnnotations(reviewId).find((a) => a.id === annotationId);
}

function persist(reviewId: string, annotations: Annotation[]) {
  localStorage.setItem(`${KEY_PREFIX}${reviewId}`, JSON.stringify(annotations));
  notify();
}

export function addAnnotation(
  reviewId: string,
  data: Omit<Annotation, "id" | "reviewId" | "createdAt" | "updatedAt" | "kind"> & {
    kind?: AnnotationKind;
  },
): Annotation {
  const annotation: Annotation = {
    ...data,
    kind: data.kind ?? "comment",
    id: crypto.randomUUID(),
    reviewId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const list = getAnnotations(reviewId);
  list.push(annotation);
  persist(reviewId, list);
  return annotation;
}

export function updateAnnotation(
  reviewId: string,
  annotationId: string,
  patch: Partial<Pick<Annotation, "note" | "thread" | "kind">>,
) {
  const list = getAnnotations(reviewId);
  const idx = list.findIndex((a) => a.id === annotationId);
  if (idx === -1) return;
  list[idx] = { ...list[idx], ...patch, updatedAt: new Date().toISOString() };
  persist(reviewId, list);
}

export function deleteAnnotation(reviewId: string, annotationId: string) {
  const list = getAnnotations(reviewId).filter((a) => a.id !== annotationId);
  persist(reviewId, list);
}
