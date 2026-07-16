/**
 * Client API for the Media tab's podcast episodes. Thin wrappers over the
 * `/api/podcasts` routes; the Media panel owns the polling loop and state.
 */

import { apiFetch } from "@/lib/client/api";
import { resolveModelCredentials } from "@/lib/keys";
import type { PodcastDTO } from "@/lib/podcast";

/** List a review's episodes, newest first. */
export async function listPodcasts(reviewId: string): Promise<PodcastDTO[]> {
  const { podcasts } = await apiFetch<{ podcasts: PodcastDTO[] }>(
    `/api/podcasts?reviewId=${encodeURIComponent(reviewId)}`,
  );
  return podcasts;
}

/** Fetch a single episode (used to poll a generating episode to completion). */
export async function getPodcast(id: string): Promise<PodcastDTO> {
  const { podcast } = await apiFetch<{ podcast: PodcastDTO }>(
    `/api/podcasts/${encodeURIComponent(id)}`,
  );
  return podcast;
}

/** Kick off generation; resolves to the new episode in its GENERATING state. */
export async function createPodcast(input: {
  reviewId: string;
  paperTitle: string;
  paperContext: string;
  instructions?: string;
}): Promise<PodcastDTO> {
  const { podcast } = await apiFetch<{ podcast: PodcastDTO }>("/api/podcasts", {
    method: "POST",
    body: { ...input, ...resolveModelCredentials() },
  });
  return podcast;
}

export async function deletePodcast(id: string): Promise<void> {
  await apiFetch(`/api/podcasts/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
