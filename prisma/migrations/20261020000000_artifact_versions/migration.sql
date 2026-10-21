-- CreateTable
CREATE TABLE "ArtifactVersion" (
    "id" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "html" TEXT NOT NULL,
    "changeSummary" TEXT NOT NULL,
    "sourceCallId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtifactVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ArtifactVersion_artifactId_number_key" ON "ArtifactVersion"("artifactId", "number");

-- AddForeignKey
ALTER TABLE "ArtifactVersion" ADD CONSTRAINT "ArtifactVersion_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "ReviewArtifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing artifacts become version 1.
INSERT INTO "ArtifactVersion" ("id", "artifactId", "number", "html", "changeSummary", "sourceCallId", "createdAt")
SELECT gen_random_uuid()::text, "id", 1, "html", 'Created', "sourceCallId", "createdAt"
FROM "ReviewArtifact";

-- AlterTable
ALTER TABLE "ReviewArtifact" DROP COLUMN "html",
ADD COLUMN "state" JSONB,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "ReviewArtifact" SET "updatedAt" = "createdAt";
