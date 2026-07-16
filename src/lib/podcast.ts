/**
 * Client-safe podcast types shared by the store, the API routes, and the Media
 * tab UI. No server-only imports so it can be bundled to the browser.
 */

export type PodcastStatus = "generating" | "ready" | "failed";

/**
 * A podcast episode as seen by the client. `audioUrl` is the app route that
 * streams the WAV (never a raw storage path); it is present only once the
 * episode is `ready`. `transcript` is the full narration script.
 */
export interface PodcastDTO {
  id: string;
  reviewId: string;
  status: PodcastStatus;
  title: string | null;
  instructions: string | null;
  transcript: string | null;
  audioUrl: string | null;
  durationSec: number | null;
  error: string | null;
  createdAt: string;
}

/** Max length of the user's free-text steer, enforced on the client and API. */
export const PODCAST_INSTRUCTIONS_MAX = 500;
