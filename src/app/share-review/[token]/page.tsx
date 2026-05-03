import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  buildShareMetadata,
  loadShare,
} from "@/server/share-landing-loader";
import ShareLandingClient from "@/components/share-landing-client";

interface PageContext {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ autoImport?: string }>;
}

const SEGMENT = "share-review";

export async function generateMetadata({
  params,
}: PageContext): Promise<Metadata> {
  const { token } = await params;
  const result = await loadShare(token).catch(() => null);
  if (!result || result.state !== "ok" || !result.preview) {
    return { title: "Shared on Artifact" };
  }
  return buildShareMetadata({
    preview: result.preview,
    ogPath: `/${SEGMENT}/${token}/og`,
  });
}

export default async function SharedReviewPage({
  params,
  searchParams,
}: PageContext) {
  const { token } = await params;
  const { autoImport } = await searchParams;
  const result = await loadShare(token);

  if (result.state === "missing") {
    notFound();
  }

  return (
    <ShareLandingClient
      token={token}
      landingPath={`/${SEGMENT}/${token}`}
      state={result.state}
      preview={result.preview ?? null}
      isOwner={result.isOwner}
      isAuthed={result.isAuthed}
      autoImport={autoImport === "1"}
    />
  );
}
