-- AlterTable
ALTER TABLE "Review" ADD COLUMN "fromRecommendationId" TEXT;

-- CreateTable
CREATE TABLE "DiscoverQuery" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoverQuery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL,
    "queryId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "arxivId" TEXT,
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiscoverQuery_userId_createdAt_idx" ON "DiscoverQuery"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Recommendation_queryId_createdAt_idx" ON "Recommendation"("queryId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Review_fromRecommendationId_key" ON "Review"("fromRecommendationId");

-- AddForeignKey
ALTER TABLE "DiscoverQuery" ADD CONSTRAINT "DiscoverQuery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_queryId_fkey" FOREIGN KEY ("queryId") REFERENCES "DiscoverQuery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_fromRecommendationId_fkey" FOREIGN KEY ("fromRecommendationId") REFERENCES "Recommendation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
