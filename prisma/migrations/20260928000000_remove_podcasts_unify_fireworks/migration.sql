-- Remove the podcast feature. Audio blobs under <userId>/podcasts/ in Supabase
-- storage are intentionally left in place and can be cleaned up separately.
DROP TABLE "Podcast";
DROP TYPE "PodcastStatus";

-- A user's own model key was stored under the legacy "openrouter" slug even
-- though it has been sent to Fireworks since the migration. Rename it so the
-- slug matches the provider. (No "fireworks" rows exist yet, so this can't hit
-- the (userId, provider) unique constraint; the guard is belt and braces.)
UPDATE "ApiKey" AS k
SET "provider" = 'fireworks'
WHERE k."provider" = 'openrouter'
  AND NOT EXISTS (
    SELECT 1 FROM "ApiKey" f
    WHERE f."userId" = k."userId" AND f."provider" = 'fireworks'
  );
