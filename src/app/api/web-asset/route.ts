import { NextRequest, NextResponse } from "next/server";
import { authedRoute, HttpError } from "@/server/api";
import { auth } from "@/server/auth";
import { fetchAsset } from "@/server/web/fetch-page";
import { isPublicHttpUrl } from "@/server/web/url-safety";

export const runtime = "nodejs";

/**
 * GET /api/web-asset?u=<absolute url>
 *
 * Same-origin relay for sub-resources a page snapshot can't load directly:
 * web fonts above all, since browsers require CORS headers on cross-origin
 * font loads and most sites don't send them. Only font, image and CSS
 * responses pass; anything else is refused.
 */
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = /^(font\/|image\/|text\/css|application\/(font|x-font|vnd\.ms-fontobject|octet-stream))/i;
const FONT_EXT = /\.(woff2?|ttf|otf|eot)(\?|#|$)/i;

export const GET = authedRoute(async (_userId, req: NextRequest) => {
  const raw = req.nextUrl.searchParams.get("u");
  const url = raw ? isPublicHttpUrl(raw) : null;
  if (!url) throw new HttpError(400, "Invalid asset URL");

  const session = await auth();
  const contactEmail = session?.user?.email ?? null;

  let upstream: Response;
  try {
    upstream = await fetchAsset(url.href, null, contactEmail);
  } catch {
    throw new HttpError(502, "Failed to fetch asset");
  }
  if (!upstream.ok || !upstream.body) {
    throw new HttpError(502, `Asset fetch failed: ${upstream.status}`);
  }
  const type = upstream.headers.get("content-type") ?? "";
  // octet-stream is only acceptable for files that look like fonts.
  const looksFont = FONT_EXT.test(url.pathname);
  if (!ALLOWED_TYPES.test(type) && !(looksFont && !type)) {
    throw new HttpError(415, "Unsupported asset type");
  }
  if (/octet-stream/i.test(type) && !looksFont) {
    throw new HttpError(415, "Unsupported asset type");
  }
  const length = Number(upstream.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) throw new HttpError(413, "Asset too large");

  return new NextResponse(upstream.body, {
    headers: {
      "Content-Type": type || "application/octet-stream",
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
});
