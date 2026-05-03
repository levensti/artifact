-- AlterTable
ALTER TABLE "Review" ADD COLUMN "importedFromShareToken" TEXT,
ADD COLUMN "importedFromName" TEXT;

-- CreateTable
CREATE TABLE "Share" (
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reviewId" TEXT,
    "wikiPageId" TEXT,
    "wikiDepth" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "lastAccessAt" TIMESTAMP(3),
    "accessCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Share_pkey" PRIMARY KEY ("token")
);

-- CreateIndex
CREATE INDEX "Share_userId_createdAt_idx" ON "Share"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Share_reviewId_idx" ON "Share"("reviewId");

-- CreateIndex
CREATE INDEX "Share_wikiPageId_idx" ON "Share"("wikiPageId");

-- AddForeignKey
ALTER TABLE "Share" ADD CONSTRAINT "Share_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Share" ADD CONSTRAINT "Share_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Share" ADD CONSTRAINT "Share_wikiPageId_fkey" FOREIGN KEY ("wikiPageId") REFERENCES "WikiPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
