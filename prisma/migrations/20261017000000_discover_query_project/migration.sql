-- AlterTable
ALTER TABLE "DiscoverQuery" ADD COLUMN "projectId" TEXT;

-- CreateIndex
CREATE INDEX "DiscoverQuery_projectId_idx" ON "DiscoverQuery"("projectId");

-- AddForeignKey
ALTER TABLE "DiscoverQuery" ADD CONSTRAINT "DiscoverQuery_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
