-- AlterTable
ALTER TABLE "Project" ADD COLUMN "notes" TEXT;

-- CreateTable
CREATE TABLE "ProjectMessages" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "messages" JSONB NOT NULL,

    CONSTRAINT "ProjectMessages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMessages_projectId_key" ON "ProjectMessages"("projectId");

-- AddForeignKey
ALTER TABLE "ProjectMessages" ADD CONSTRAINT "ProjectMessages_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
