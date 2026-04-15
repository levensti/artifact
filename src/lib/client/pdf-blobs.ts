/**
 * Client-side PDF blob storage. Uploaded local PDFs live in IndexedDB
 * (not the server filesystem), keyed by a UUID that doubles as the
 * review's `pdfPath`. The review page reads the blob out and turns it
 * into an object URL for react-pdf.
 */

import { getDb } from "@/lib/client/db";

/** Persist a File/Blob and return an opaque id for the stored PDF. */
export async function savePdfBlob(file: File): Promise<string> {
  const id = crypto.randomUUID();
  await getDb().pdfBlobs.put({
    id,
    blob: file,
    name: file.name ?? null,
    createdAt: new Date().toISOString(),
  });
  return id;
}

/** Fetch a previously stored PDF blob by id, or null if not found. */
export async function loadPdfBlob(id: string): Promise<Blob | null> {
  const row = await getDb().pdfBlobs.get(id);
  return row?.blob ?? null;
}

export async function deletePdfBlob(id: string): Promise<void> {
  await getDb().pdfBlobs.delete(id);
}
