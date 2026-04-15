import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  const allowed = /^https:\/\/(arxiv\.org|export\.arxiv\.org)\//;
  if (!allowed.test(url)) {
    return NextResponse.json(
      { error: "Only arxiv.org URLs are supported" },
      { status: 400 },
    );
  }

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "PaperCopilot/1.0" },
      redirect: "follow",
    });

    if (response.url && !allowed.test(response.url)) {
      return NextResponse.json(
        { error: "Redirected to non-arxiv URL" },
        { status: 403 },
      );
    }

    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch PDF: ${response.status}` },
        { status: response.status },
      );
    }

    const pdfBuffer = await response.arrayBuffer();

    return new NextResponse(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return NextResponse.json({ error: "Failed to fetch PDF" }, { status: 500 });
  }
}
