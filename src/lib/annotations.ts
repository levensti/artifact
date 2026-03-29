import type { ChatAssistantBlock } from "@/lib/reviews";
import {
  loadAnnotations,
  saveAnnotations,
} from "@/lib/client-data";

export { ANNOTATIONS_UPDATED_EVENT } from "@/lib/storage-events";

/** Margin note (kind "comment") vs passage thread (kind "ask_ai"; UI: Dive deeper) */
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

export async function getAnnotations(
  reviewId: string,
): Promise<Annotation[]> {
  const list = await loadAnnotations(reviewId);
  return list.map((a) => ({
    ...a,
    kind: a.kind ?? "comment",
  }));
}

export async function getAnnotation(
  reviewId: string,
  annotationId: string,
): Promise<Annotation | undefined> {
  const list = await getAnnotations(reviewId);
  return list.find((a) => a.id === annotationId);
}

export async function addAnnotation(
  reviewId: string,
  data: Omit<
    Annotation,
    "id" | "reviewId" | "createdAt" | "updatedAt" | "kind"
  > & {
    kind?: AnnotationKind;
  },
): Promise<Annotation> {
  const annotation: Annotation = {
    ...data,
    kind: data.kind ?? "comment",
    id: crypto.randomUUID(),
    reviewId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const list = await loadAnnotations(reviewId);
  list.push(annotation);
  await saveAnnotations(reviewId, list);
  return annotation;
}

export async function updateAnnotation(
  reviewId: string,
  annotationId: string,
  patch: Partial<Pick<Annotation, "note" | "thread" | "kind">>,
): Promise<void> {
  const list = await loadAnnotations(reviewId);
  const idx = list.findIndex((a) => a.id === annotationId);
  if (idx === -1) return;
  list[idx] = { ...list[idx], ...patch, updatedAt: new Date().toISOString() };
  await saveAnnotations(reviewId, list);
}

export async function deleteAnnotation(
  reviewId: string,
  annotationId: string,
): Promise<void> {
  const list = (await loadAnnotations(reviewId)).filter(
    (a) => a.id !== annotationId,
  );
  await saveAnnotations(reviewId, list);
}
