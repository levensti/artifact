import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");

  if (!url) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  // Validate it's an arxiv URL to prevent open proxy abuse
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
    });

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
