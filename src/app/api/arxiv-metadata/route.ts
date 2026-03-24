import { NextRequest, NextResponse } from "next/server";

/** arXiv id like 2402.00277 (no version suffix). */
const ARXIV_ID_RE = /^\d{4}\.\d{4,5}$/;

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id")?.trim();
  if (!id || !ARXIV_ID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid arXiv id" }, { status: 400 });
  }

  try {
    const url = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "PaperCopilot/1.0 (https://github.com; academic use)",
      },
      next: { revalidate: 86400 },
    });
    if (!res.ok) {
      return NextResponse.json({ title: null });
    }
    const xml = await res.text();
    const entryStart = xml.indexOf("<entry>");
    if (entryStart === -1) {
      return NextResponse.json({ title: null });
    }
    const entry = xml.slice(entryStart);
    const titleMatch = entry.match(/<title>([\s\S]*?)<\/title>/);
    if (!titleMatch) {
      return NextResponse.json({ title: null });
    }
    const title = titleMatch[1].replace(/\s+/g, " ").trim();
    return NextResponse.json({ title: title || null });
  } catch {
    return NextResponse.json({ title: null });
  }
}
