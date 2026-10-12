/**
 * Document registration.
 *
 * The browser extracts a paper's text (with `[Page N]` markers) and its PDF
 * outline, hashes the text, and posts all of it here. The server stores the
 * document once per hash (shared across every reader of the same paper),
 * links the caller's review to it, and kicks off indexing after the response
 * when the document is new. The client polls `GET /api/documents/:hash`.
 *
 * The hash is recomputed server-side so a client can't attach arbitrary text
 * to another document's identity.
 */

import { NextRequest, NextResponse, after } from "next/server";
import { createHash } from "node:crypto";
import { jsonError } from "@/lib/api-utils";
import { requireUserId, HttpError, errorResponse } from "@/server/api";
import { resolveMeteredKey, charge, EMBEDDING_TOKEN_WEIGHT } from "@/server/rate-limit";
import * as docs from "@/server/documents";
import * as store from "@/server/store";
import { indexDocument } from "@/server/indexing/index-document";
import { sanitizeExtractedText, type DocumentOutlineEntry } from "@/lib/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Indexing a textbook can take a minute or two of embedding calls. */
export const maxDuration = 300;

/** ~3M characters ≈ 750k tokens — same cap as the LLM parse endpoint. */
const MAX_TEXT_CHARS = 3_000_000;
const MAX_OUTLINE_ENTRIES = 2_000;

interface RegisterRequest {
  hash: string;
  text: string;
  title?: string;
  outline?: DocumentOutlineEntry[];
  reviewId?: string;
  /** Optional per-user Fireworks key override for the embedding calls. */
  apiKey?: string;
}

export async function POST(req: NextRequest) {
  let body: RegisterRequest;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }
  const { hash, title, outline, reviewId, apiKey } = body;
  if (typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) {
    return jsonError("hash must be a sha256 hex digest.", 400);
  }
  if (typeof body.text !== "string" || !body.text.trim()) {
    return jsonError("text is required.", 400);
  }
  const text = sanitizeExtractedText(body.text);
  if (text.length > MAX_TEXT_CHARS) {
    return jsonError(`Document is too large (${text.length.toLocaleString()} chars).`, 413);
  }
  const computed = createHash("sha256").update(text, "utf8").digest("hex");
  if (computed !== hash) {
    return jsonError("hash does not match text.", 400);
  }

  let userId: string;
  try {
    userId = await requireUserId();
  } catch (err) {
    if (err instanceof HttpError) return errorResponse(err);
    throw err;
  }

  try {
    return await register(userId, { hash, text, title, outline, reviewId, apiKey });
  } catch (err) {
    // Return JSON so the client can show the cause, not a bare 500.
    return errorResponse(err);
  }
}

async function register(
  userId: string,
  { hash, text, title, outline, reviewId, apiKey }: RegisterRequest,
): Promise<NextResponse> {
  const cleanOutline = sanitizeOutline(outline);
  const { doc, textStored } = await docs.registerDocument({
    hash,
    text,
    title: typeof title === "string" ? title.trim() || null : null,
    outline: cleanOutline,
  });

  if (typeof reviewId === "string" && reviewId) {
    const review = await store.getReview(userId, reviewId);
    if (review) await docs.linkReviewDocument(userId, reviewId, doc.id);
  }

  // Index when the text is new, when a previous attempt failed or wedged, or
  // when the stored vectors predate the current embedding model.
  // `claimForIndexing` (inside indexDocument) makes the concurrent-first-
  // readers case safe: only one of two simultaneous uploads does the work.
  if (textStored || docs.needsIndexing(doc)) {
    const outcome = await resolveMeteredKey(apiKey);
    if (!outcome.ok) {
      // No key to embed with (platform allowance spent and no personal key,
      // or no key configured at all). Record it so the status endpoint and
      // the chat header say why, instead of a document that sits in
      // `pending` forever; the next open retries once a key is available.
      const reason =
        outcome.reason === "rate_limited"
          ? "Usage limit reached; add your own Fireworks key in Settings to index this document."
          : "No Fireworks API key available for indexing.";
      console.warn(`Indexing skipped for document ${doc.id}: ${outcome.reason}`);
      await docs.markIndexFailed(doc.id, reason);
      return NextResponse.json(docs.toStatus({ ...doc, indexStatus: "failed", indexError: reason }));
    }
    {
      const key = outcome.apiKey;
      const meterUser = outcome.meter ? outcome.userId : null;
      console.log(`Indexing queued for document ${doc.id} (${doc.charCount.toLocaleString()} chars)`);
      after(async () => {
        await indexDocument({
          documentId: doc.id,
          apiKey: key,
          onUsage: (usage) => {
            if (meterUser && usage.tokens > 0) {
              void charge(meterUser, usage.tokens * EMBEDDING_TOKEN_WEIGHT);
            }
          },
        });
      });
      return NextResponse.json(
        docs.toStatus({ ...doc, indexStatus: "indexing" }),
      );
    }
  }

  return NextResponse.json(docs.toStatus(doc));
}

function sanitizeOutline(raw: unknown): DocumentOutlineEntry[] | null {
  if (!Array.isArray(raw)) return null;
  const out: DocumentOutlineEntry[] = [];
  for (const item of raw.slice(0, MAX_OUTLINE_ENTRIES)) {
    if (!item || typeof item !== "object") continue;
    const { title, page, depth } = item as Record<string, unknown>;
    if (typeof title !== "string" || typeof page !== "number" || !Number.isInteger(page)) continue;
    if (page < 1) continue;
    out.push({
      title: title.slice(0, 300),
      page,
      depth: typeof depth === "number" && depth >= 0 ? Math.min(depth, 6) : 0,
    });
  }
  return out.length > 0 ? out : null;
}
