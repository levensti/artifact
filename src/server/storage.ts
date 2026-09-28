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

export async function downloadPdf(path: string): Promise<Blob> {
  const { data, error } = await client().storage.from(bucket()).download(path);
  if (error) throw new Error(`pdf download failed: ${error.message}`);
  return data;
}

export async function deletePdf(path: string): Promise<void> {
  const { error } = await client().storage.from(bucket()).remove([path]);
  if (error) throw new Error(`pdf delete failed: ${error.message}`);
}
