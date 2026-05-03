/**
 * Path helpers for the public share landing pages.
 *
 * Two entry-points — `/share-review/<token>` and `/share-journal/<token>` —
 * exist for unfurling clarity (the kind shows up in the URL, so a Slack
 * user can tell what they're about to click). The token alone resolves
 * to a single Share row regardless of which prefix was used; the
 * prefix is presentation, not authorization.
 */

import type { ShareKind } from "@/lib/client/sharing/share-links";

export type ShareSegment = "share-review" | "share-journal";

export function shareSegment(kind: ShareKind): ShareSegment {
  return kind === "wiki" ? "share-journal" : "share-review";
}

export function shareLandingPath(kind: ShareKind, token: string): string {
  return `/${shareSegment(kind)}/${token}`;
}

export function shareOgPath(kind: ShareKind, token: string): string {
  return `/${shareSegment(kind)}/${token}/og`;
}
