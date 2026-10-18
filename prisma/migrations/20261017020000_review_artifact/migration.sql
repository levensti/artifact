-- CreateTable
CREATE TABLE "ReviewArtifact" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "sourceCallId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReviewArtifact_reviewId_createdAt_idx" ON "ReviewArtifact"("reviewId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewArtifact_reviewId_sourceCallId_key" ON "ReviewArtifact"("reviewId", "sourceCallId");

-- AddForeignKey
ALTER TABLE "ReviewArtifact" ADD CONSTRAINT "ReviewArtifact_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;
