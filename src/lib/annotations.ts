export interface Annotation {
  id: string;
  reviewId: string;
  pageNumber: number;
  highlightText: string;
  anchorRects: { x: number; y: number; w: number; h: number }[];
  note: string;
  thread: AnnotationMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface AnnotationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
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
    return JSON.parse(raw) as Annotation[];
  } catch {
    return [];
  }
}

function persist(reviewId: string, annotations: Annotation[]) {
  localStorage.setItem(`${KEY_PREFIX}${reviewId}`, JSON.stringify(annotations));
  notify();
}

export function addAnnotation(
  reviewId: string,
  data: Omit<Annotation, "id" | "reviewId" | "createdAt" | "updatedAt">,
): Annotation {
  const annotation: Annotation = {
    ...data,
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
  patch: Partial<Pick<Annotation, "note" | "thread">>,
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
