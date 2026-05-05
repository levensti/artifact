-- Drop the Prerequisites table; the feature has been removed.
ALTER TABLE "Prerequisites" DROP CONSTRAINT IF EXISTS "Prerequisites_reviewId_fkey";
DROP TABLE IF EXISTS "Prerequisites";
