import { NextResponse } from "next/server";
import { gzipSync, createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { authedRoute, HttpError } from "@/server/api";
import { auth } from "@/server/auth";
import * as store from "@/server/store";
import {
  createSignedReadUrl,
  downloadObjectIfExists,
  objectExists,
  uploadObject,
  webSnapshotPath,
} from "@/server/storage";
import { fetchPage } from "@/server/web/fetch-page";
import { buildSnapshot, SNAPSHOT_CSP } from "@/server/web/snapshot";
import { isPublicHttpUrl } from "@/server/web/url-safety";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/**
 * The frozen copy of a web review's page (see web-viewer.tsx). Built on first
 * open from the live page and stored gzipped, so later opens are a storage
 * read and the review keeps rendering even if the page changes or goes away.
 *
 * Reads don't flow through this function: the default response is a
 * short-lived signed storage URL the browser fetches directly and inflates
 * (a filing can run to 14MB uncompressed). `?format=html` streams the
 * inflated document instead, for browsers without DecompressionStream.
 * `?refresh=1` rebuilds from the live page.
 */
const SIGNED_URL_TTL_SECONDS = 3600;

const HTML_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy": `${SNAPSHOT_CSP}; frame-ancestors 'self'`,
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "private, max-age=600",
};

async function ensureSnapshot(
  userId: string,
  reviewId: string,
  sourceUrl: string,
  refresh: boolean,
): Promise<{ path: string; stored: boolean; html?: string }> {
  const path = webSnapshotPath(userId, reviewId);
  if (!refresh && (await objectExists(path))) return { path, stored: true };

  const pageUrl = isPublicHttpUrl(sourceUrl);
  if (!pageUrl) throw new HttpError(400, "Only public http(s) URLs are supported");

  const session = await auth();
  const contactEmail = session?.user?.email ?? null;

  let response: Response;
  try {
    response = await fetchPage(pageUrl.href, contactEmail);
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new HttpError(504, "Request timed out while fetching the page");
    }
    throw new HttpError(502, "Failed to fetch the page");
  }
  if (!response.ok) {
    throw new HttpError(
      502,
      `Failed to fetch page: ${response.status} ${response.statusText}`,
    );
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
    throw new HttpError(
      415,
      contentType.includes("application/pdf")
        ? "This URL points to a PDF."
        : `Unsupported content type: ${contentType}. Only HTML pages are supported.`,
    );
  }

  const sourceHtml = await response.text();
  const snapshot = await buildSnapshot(sourceHtml, {
    // Resolve against the final URL so relative paths survive redirects.
    pageUrl: response.url || pageUrl.href,
    contactEmail,
    proxyUrl: (u) => `/api/web-asset?u=${encodeURIComponent(u)}`,
  });

  try {
    await uploadObject(path, gzipSync(Buffer.from(snapshot.html, "utf8")), "application/gzip");
    return { path, stored: true };
  } catch (err) {
    // Storage trouble shouldn't block reading: hand the document over
    // inline this once; the next open tries to store again.
    console.error("web snapshot store failed:", err);
    return { path, stored: false, html: snapshot.html };
  }
}

export const GET = authedRoute(async (userId, req: Request, { params }: Ctx) => {
  const { id } = await params;
  const review = await store.getReview(userId, id);
  if (!review) throw new HttpError(404, "Review not found");
  if (!review.sourceUrl) throw new HttpError(400, "Review has no web source");

  const search = new URL(req.url).searchParams;
  const refresh = search.get("refresh") === "1";
  const wantHtml = search.get("format") === "html";

  const result = await ensureSnapshot(userId, id, review.sourceUrl, refresh);

  if (!result.stored) {
    if (wantHtml) return new Response(result.html, { headers: HTML_HEADERS });
    return NextResponse.json({ format: "inline", html: result.html });
  }

  if (wantHtml) {
    const blob = await downloadObjectIfExists(result.path);
    if (!blob) throw new HttpError(404, "Snapshot missing");
    const inflated = Readable.fromWeb(
      blob.stream() as import("node:stream/web").ReadableStream,
    ).pipe(createGunzip());
    return new Response(Readable.toWeb(inflated) as ReadableStream, {
      headers: HTML_HEADERS,
    });
  }

  const url = await createSignedReadUrl(result.path, SIGNED_URL_TTL_SECONDS);
  return NextResponse.json({ format: "gzip", url });
});
