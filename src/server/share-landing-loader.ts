import "server-only";
import { cache } from "react";
import type { Metadata } from "next";
import { auth } from "./auth";
import { HttpError } from "./api";
import { getSharePreview, type SharePreview } from "./shares";

export interface LoaderResult {
  state: "ok" | "revoked" | "missing";
  preview?: SharePreview;
  isOwner: boolean;
  isAuthed: boolean;
}

/// Hydrate a share token into the data the public landing needs:
/// preview payload, viewer's session state, and whether the viewer is
/// the share's owner. Wrapped in React's `cache()` so a single page
/// render that calls this from both `generateMetadata` and the page
/// component itself only hits the DB once.
export const loadShare = cache(loadShareImpl);

async function loadShareImpl(token: string): Promise<LoaderResult> {
  const session = await auth();
  const viewerUserId = session?.user?.id ?? null;
  try {
    const preview = await getSharePreview(token);
    if (!preview) {
      return { state: "missing", isOwner: false, isAuthed: !!viewerUserId };
    }
    // ownerUserId is part of the preview now — no second `share.findUnique`.
    const isOwner = !!viewerUserId && preview.ownerUserId === viewerUserId;
    return {
      state: "ok",
      preview: { ...preview, isOwner },
      isOwner,
      isAuthed: !!viewerUserId,
    };
  } catch (err) {
    if (err instanceof HttpError && err.status === 410) {
      return { state: "revoked", isOwner: false, isAuthed: !!viewerUserId };
    }
    throw err;
  }
}

export interface BuildMetadataArgs {
  preview: SharePreview;
  /// Path the OG image lives at, e.g. `/share/<token>/og`. Page passes
  /// this so the meta links to its sibling route, not a hard-coded
  /// path that could drift.
  ogPath: string;
}

/// Open Graph + Twitter card metadata for the share landing. Returns a
/// plain title only when the share is missing/revoked so the unfurl
/// degrades gracefully rather than rendering a default Artifact card
/// that misleads about the link's status.
export function buildShareMetadata({
  preview,
  ogPath,
}: BuildMetadataArgs): Metadata {
  const sharer = preview.sharerFirstName ?? "Someone";
  const isReview = preview.payload.kind === "review";
  const subject = isReview
    ? (preview.payload as Extract<SharePreview["payload"], { kind: "review" }>).title
    : (preview.payload as Extract<SharePreview["payload"], { kind: "wiki" }>).rootTitle;
  const action = isReview ? "shared a paper review" : "shared a journal entry";
  const title = `${sharer} ${action} on Artifact`;
  const description = subject;
  // Cache-bust when the share is recreated after revocation by piggybacking
  // on the creation timestamp.
  const ogVersion = String(new Date(preview.createdAt).getTime());
  const ogUrl = `${ogPath}?v=${ogVersion}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "article",
      images: [{ url: ogUrl, width: 1200, height: 630, alt: subject }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogUrl],
    },
  };
}
