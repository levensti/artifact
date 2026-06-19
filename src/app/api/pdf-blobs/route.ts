import { NextResponse } from "next/server";
import { authedRoute } from "@/server/api";
import * as store from "@/server/store";
import { uploadPdf } from "@/server/storage";

export const runtime = "nodejs";

export const POST = authedRoute(async (userId, request: Request) => {
  const contentType = request.headers.get("content-type") ?? "";

  // JSON body with a `url` ingests a remote PDF server-side (avoids browser
  // CORS). Used when a PDF link is pasted into the Web tab.
  if (contentType.includes("application/json")) {
    let url: unknown;
    try {
      ({ url } = await request.json());
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    if (typeof url !== "string") {
      return NextResponse.json({ error: "url is required" }, { status: 400 });
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

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { "User-Agent": "Artifact/1.0" },
        redirect: "follow",
        signal: AbortSignal.timeout(25_000),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        return NextResponse.json(
          { error: "Request timed out while fetching the PDF" },
          { status: 504 },
        );
      }
      return NextResponse.json(
        { error: "Failed to fetch the PDF" },
        { status: 502 },
      );
    }
    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch PDF: ${response.status}` },
        { status: 502 },
      );
    }
    const respType = response.headers.get("content-type") ?? "";
    if (!respType.includes("application/pdf")) {
      return NextResponse.json(
        { error: `Expected a PDF but got: ${respType || "unknown"}` },
        { status: 400 },
      );
    }

    const id = crypto.randomUUID();
    const buffer = Buffer.from(await response.arrayBuffer());
    const name =
      decodeURIComponent(parsed.pathname.split("/").pop() || "") || null;
    const path = await uploadPdf(userId, id, buffer);
    await store.recordPdfBlob(userId, id, path, name);
    return NextResponse.json({ id });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  const id = crypto.randomUUID();
  const buffer = Buffer.from(await file.arrayBuffer());
  const path = await uploadPdf(userId, id, buffer);
  await store.recordPdfBlob(userId, id, path, file.name || null);
  return NextResponse.json({ id });
});
