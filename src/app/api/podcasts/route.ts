import { NextResponse, after } from "next/server";
import { z } from "zod";
import { jsonError } from "@/lib/api-utils";
import { adminRoute } from "@/server/api";
import * as store from "@/server/store";
import { uploadAudio } from "@/server/storage";
import { generatePodcast } from "@/server/podcast";
import { resolveMeteredKey, charge, meteredTokens } from "@/server/rate-limit";
import type { OpenRouterUsage } from "@/lib/openrouter";
import { PODCAST_INSTRUCTIONS_MAX } from "@/lib/podcast";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Script generation + chunked TTS synthesis can run well past a normal request;
// generation itself happens in `after()`, but give the invocation room.
export const maxDuration = 300;

const createSchema = z.object({
  reviewId: z.string().min(1),
  paperTitle: z.string().max(1_000).optional(),
  paperContext: z.string().min(1).max(500_000),
  instructions: z.string().max(PODCAST_INSTRUCTIONS_MAX).optional(),
  // Optional per-user OpenRouter key; falls back to the platform key/allowance.
  apiKey: z.string().optional(),
});

/**
 * Start generating a podcast episode for a review. Creates the row up front in
 * GENERATING (so a refresh shows the spinner and can poll), then runs the
 * script → audio → upload pipeline in `after()` and flips the row to
 * READY/FAILED. Returns the GENERATING episode immediately.
 */
export const POST = adminRoute(async (userId, request: Request) => {
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError("Invalid request body.", 400);
  }
  const { reviewId, paperTitle, paperContext, instructions } = parsed.data;

  // Resolve the key (and gate on the allowance) BEFORE creating a row, so an
  // unauthorized or rate-limited caller never leaves a stray GENERATING row.
  const outcome = await resolveMeteredKey(parsed.data.apiKey);
  if (!outcome.ok) {
    return outcome.reason === "rate_limited"
      ? jsonError(
          "You've reached the current usage limit. Add your own OpenRouter key for higher limits.",
          429,
        )
      : jsonError(
          "API key is required. Manage API keys in the app to add one.",
          401,
        );
  }
  const { apiKey, meter, userId: meterUserId } = outcome;

  const id = crypto.randomUUID();
  let podcast;
  try {
    podcast = await store.createPodcast(userId, {
      id,
      reviewId,
      title: paperTitle ?? null,
      instructions: instructions ?? null,
    });
  } catch (err) {
    // assertReviewOwned throws for a review the user doesn't own.
    return jsonError(
      err instanceof Error ? err.message : "Could not start generation.",
      404,
    );
  }

  after(async () => {
    try {
      const { transcript, audio, durationSec, usages } = await generatePodcast(
        apiKey,
        { paperTitle: paperTitle ?? "", paperContext, instructions },
      );
      const audioPath = await uploadAudio(userId, id, audio);
      await store.setPodcastReady(userId, id, {
        transcript,
        audioPath,
        durationSec,
      });
      if (meter && meterUserId) {
        const total = usages.reduce((sum, u) => sum + usageTotal(u), 0);
        await charge(meterUserId, total);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Podcast generation failed.";
      await store
        .setPodcastFailed(userId, id, message)
        .catch((e) => console.error("[podcasts] failed to record failure:", e));
    }
  });

  return NextResponse.json({ podcast });
});

/** List a review's episodes, newest first. */
export const GET = adminRoute(async (userId, request: Request) => {
  const reviewId = new URL(request.url).searchParams.get("reviewId");
  if (!reviewId) return jsonError("reviewId is required.", 400);
  const podcasts = await store.listPodcastsForReview(userId, reviewId);
  return NextResponse.json({ podcasts });
});

/**
 * Tokens charged for one usage report, cost-weighted (mirrors the /api/generate
 * accounting): full-rate uncached input + completion, cache reads discounted.
 */
function usageTotal(usage: OpenRouterUsage): number {
  const prompt = usage.prompt_tokens ?? 0;
  const completion = usage.completion_tokens ?? 0;
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  const uncachedInput = Math.max(0, prompt - cached);
  return meteredTokens(uncachedInput, cached, completion);
}
