import {
  loadAnnotations,
  saveAnnotations,
} from "@/lib/client-data";

export { ANNOTATIONS_UPDATED_EVENT } from "@/lib/storage-events";

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

export async function getAnnotations(
  reviewId: string,
): Promise<Annotation[]> {
  return loadAnnotations(reviewId);
}

export async function addAnnotation(
  reviewId: string,
  data: Omit<Annotation, "id" | "reviewId" | "createdAt" | "updatedAt">,
): Promise<Annotation> {
  const annotation: Annotation = {
    ...data,
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
  patch: Partial<Pick<Annotation, "note" | "thread">>,
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
