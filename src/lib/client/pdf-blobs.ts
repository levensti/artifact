/**
 * Client-side PDF blob storage. Uploaded PDFs are streamed to the server
 * (which writes them to Supabase Storage), and the server returns an opaque
 * id. The review's `pdfPath` holds that id; `loadPdfBlob` round-trips it
 * through the API to fetch the bytes back.
 */

export async function savePdfBlob(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/pdf-blobs", {
    method: "POST",
    credentials: "same-origin",
    body: form,
  });
  if (!res.ok) {
    const message =
      (await res.json().then((d) => d?.error).catch(() => null)) ||
      `PDF upload failed (${res.status})`;
    throw new Error(message);
  }
  const { id } = (await res.json()) as { id: string };
  return id;
}

export async function loadPdfBlob(id: string): Promise<Blob | null> {
  const res = await fetch(`/api/pdf-blobs/${encodeURIComponent(id)}`, {
    credentials: "same-origin",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`PDF download failed (${res.status})`);
  return await res.blob();
}

export async function deletePdfBlob(id: string): Promise<void> {
  const res = await fetch(`/api/pdf-blobs/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`PDF delete failed (${res.status})`);
  }
}
