import fs from "fs";
import path from "path";

export const runtime = "nodejs";

/**
 * Serves the user-editable `docs/wiki-schema.md` file to the client. The
 * wiki ingest pipeline injects this into the ingest prompt on every run,
 * so editing the .md file reshapes how the background agent builds the
 * knowledge base — no rebuild required.
 */
export async function GET() {
  const filePath = path.join(process.cwd(), "docs", "wiki-schema.md");
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return new Response(content, {
      status: 200,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new Response("", {
      status: 200,
      headers: { "Content-Type": "text/markdown; charset=utf-8" },
    });
  }
}
