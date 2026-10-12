/**
 * Client-side PDF blob storage. Uploaded PDFs go straight from the browser
 * to Supabase Storage through a signed URL the server mints, so the bytes
 * never pass through a Vercel function (which rejects bodies over 4.5MB
 * with a 413). The server returns an opaque id; the review's `pdfPath`
 * holds that id, and `loadPdfBlob` round-trips it through the API to fetch
 * the bytes back.
 */

async function errorFrom(res: Response, fallback: string): Promise<Error> {
  const message =
    (await res.json().then((d) => d?.error ?? d?.message).catch(() => null)) ||
    `${fallback} (${res.status})`;
  return new Error(message);
}

export async function savePdfBlob(file: File): Promise<string> {
  // 1. Reserve an id and a signed upload URL.
  const urlRes = await fetch("/api/pdf-blobs/upload-url", {
    method: "POST",
    credentials: "same-origin",
  });
  if (!urlRes.ok) throw await errorFrom(urlRes, "PDF upload failed");
  const { id, uploadUrl } = (await urlRes.json()) as {
    id: string;
    uploadUrl: string;
  };

  // 2. Upload the bytes directly to storage.
  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "content-type": "application/pdf", "x-upsert": "false" },
    body: file,
  });
  if (!putRes.ok) {
    if (putRes.status === 413) {
      throw new Error("This PDF is larger than the storage size limit.");
    }
    throw await errorFrom(putRes, "PDF upload failed");
  }

  // 3. Record the blob now that the object exists.
  const doneRes = await fetch(
    `/api/pdf-blobs/${encodeURIComponent(id)}/complete`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: file.name || null }),
    },
  );
  if (!doneRes.ok) throw await errorFrom(doneRes, "PDF upload failed");
  return id;
}

/**
 * Ingests a remote PDF by URL. The server fetches the bytes (sidestepping
 * browser CORS) and stores them like an uploaded file, returning the blob id.
 */
export async function savePdfBlobFromUrl(url: string): Promise<string> {
  const res = await fetch("/api/pdf-blobs", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const message =
      (await res.json().then((d) => d?.error).catch(() => null)) ||
      `PDF fetch failed (${res.status})`;
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
