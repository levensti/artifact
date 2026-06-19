import { NextRequest, NextResponse } from "next/server";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

export const runtime = "nodejs";

/**
 * GET /api/web-content?url=...
 *
 * Fetches an arbitrary web page, extracts readable content using
 * Mozilla Readability, and returns:
 *   - title: page title
 *   - textContent: plain-text extraction (for AI context)
 *   - htmlContent: sanitized HTML (for reader-view display)
 *   - siteName: detected site name
 *   - excerpt: short excerpt / description
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json(
      { error: "Missing url parameter" },
      { status: 400 },
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return NextResponse.json(
      { error: "Only http and https URLs are supported" },
      { status: 400 },
    );
  }

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(25_000),
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          error: `Failed to fetch page: ${response.status} ${response.statusText}`,
        },
        { status: 502 },
      );
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml")
    ) {
      // PDFs reach the Web tab too. Signal the client so it can hand off
      // to the PDF ingestion path instead of surfacing a dead end.
      const isPdf = contentType.includes("application/pdf");
      return NextResponse.json(
        {
          error: isPdf
            ? "This URL points to a PDF."
            : `Unsupported content type: ${contentType}. Only HTML pages are supported.`,
          isPdf,
        },
        { status: 400 },
      );
    }

    const html = await response.text();
    const { document } = parseHTML(html);
    const reader = new Readability(document);
    const article = reader.parse();

    if (!article) {
      return NextResponse.json(
        {
          error:
            "Could not extract readable content from this page. The page may be too dynamic or require JavaScript.",
        },
        { status: 422 },
      );
    }

    return NextResponse.json({
      title: article.title || parsed.hostname,
      textContent: article.textContent || "",
      htmlContent: article.content || "",
      siteName: article.siteName || parsed.hostname,
      excerpt: article.excerpt || "",
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      return NextResponse.json(
        { error: "Request timed out while fetching the page" },
        { status: 504 },
      );
    }
    return NextResponse.json(
      {
        error: `Failed to fetch page: ${err instanceof Error ? err.message : "Unknown error"}`,
      },
      { status: 500 },
    );
  }
}
