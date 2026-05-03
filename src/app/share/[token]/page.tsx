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
    ogPath: `/share/${token}/og`,
  });
}

export default async function SharePage({
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
      landingPath={`/share/${token}`}
      state={result.state}
      preview={result.preview ?? null}
      isOwner={result.isOwner}
      isAuthed={result.isAuthed}
      autoImport={autoImport === "1"}
    />
  );
}
