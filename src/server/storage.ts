import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

function client(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }
  _client = createClient(url, key, { auth: { persistSession: false } });
  return _client;
}

function bucket(): string {
  return process.env.SUPABASE_BUCKET ?? "learning-material";
}

function pathFor(userId: string, id: string): string {
  return `${userId}/${id}.pdf`;
}

export async function uploadPdf(
  userId: string,
  id: string,
  body: Blob | ArrayBuffer | Buffer | Uint8Array,
  contentType = "application/pdf",
): Promise<string> {
  const path = pathFor(userId, id);
  const { error } = await client()
    .storage.from(bucket())
    .upload(path, body, { contentType, upsert: true });
  if (error) {
    const detail = JSON.stringify(error, Object.getOwnPropertyNames(error));
    throw new Error(
      `pdf upload failed (bucket=${bucket()}): ${error.message} :: ${detail}`,
    );
  }
  return path;
}

/**
 * Mint a signed URL the browser can PUT a PDF to directly, so large files
 * never pass through a Vercel function (which caps request bodies at 4.5MB).
 * The URL is scoped to this one path and expires after 2 hours.
 */
export async function createPdfUploadUrl(
  userId: string,
  id: string,
): Promise<{ path: string; signedUrl: string }> {
  const path = pathFor(userId, id);
  const { data, error } = await client()
    .storage.from(bucket())
    .createSignedUploadUrl(path);
  if (error) {
    throw new Error(
      `pdf upload url failed (bucket=${bucket()}): ${error.message}`,
    );
  }
  return { path, signedUrl: data.signedUrl };
}

/** Storage path of the user's uploaded PDF for `id`, or null if absent. */
export async function findUploadedPdf(
  userId: string,
  id: string,
): Promise<string | null> {
  const path = pathFor(userId, id);
  const { data, error } = await client().storage.from(bucket()).exists(path);
  return !error && data ? path : null;
}

export async function downloadPdf(path: string): Promise<Blob> {
  const { data, error } = await client().storage.from(bucket()).download(path);
  if (error) throw new Error(`pdf download failed: ${error.message}`);
  return data;
}

export async function deletePdf(path: string): Promise<void> {
  const { error } = await client().storage.from(bucket()).remove([path]);
  if (error) throw new Error(`pdf delete failed: ${error.message}`);
}
