/*
  Warnings:

  - The primary key for the `ParsedPaper` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `Prerequisites` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `ReviewAnnotations` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `ReviewMessages` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `Setting` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `WikiBacklink` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `WikiPageSource` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - A unique constraint covering the columns `[userId,hash]` on the table `ParsedPaper` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[reviewId]` on the table `Prerequisites` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[reviewId]` on the table `ReviewAnnotations` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[reviewId]` on the table `ReviewMessages` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[userId,key]` on the table `Setting` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[sourceId,targetSlug]` on the table `WikiBacklink` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[pageId,reviewId]` on the table `WikiPageSource` will be added. If there are existing duplicate values, this will fail.
  - The required column `id` was added to the `ParsedPaper` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.
  - The required column `id` was added to the `Prerequisites` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.
  - The required column `id` was added to the `ReviewAnnotations` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.
  - The required column `id` was added to the `ReviewMessages` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.
  - The required column `id` was added to the `Setting` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.
  - The required column `id` was added to the `WikiBacklink` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.
  - The required column `id` was added to the `WikiPageSource` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.

*/
-- AlterTable
ALTER TABLE "ParsedPaper" DROP CONSTRAINT "ParsedPaper_pkey",
ADD COLUMN     "id" TEXT NOT NULL,
ADD CONSTRAINT "ParsedPaper_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "Prerequisites" DROP CONSTRAINT "Prerequisites_pkey",
ADD COLUMN     "id" TEXT NOT NULL,
ADD CONSTRAINT "Prerequisites_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "ReviewAnnotations" DROP CONSTRAINT "ReviewAnnotations_pkey",
ADD COLUMN     "id" TEXT NOT NULL,
ADD CONSTRAINT "ReviewAnnotations_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "ReviewMessages" DROP CONSTRAINT "ReviewMessages_pkey",
ADD COLUMN     "id" TEXT NOT NULL,
ADD CONSTRAINT "ReviewMessages_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "Setting" DROP CONSTRAINT "Setting_pkey",
ADD COLUMN     "id" TEXT NOT NULL,
ADD CONSTRAINT "Setting_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "WikiBacklink" DROP CONSTRAINT "WikiBacklink_pkey",
ADD COLUMN     "id" TEXT NOT NULL,
ADD CONSTRAINT "WikiBacklink_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "WikiPageSource" DROP CONSTRAINT "WikiPageSource_pkey",
ADD COLUMN     "id" TEXT NOT NULL,
ADD CONSTRAINT "WikiPageSource_pkey" PRIMARY KEY ("id");

-- CreateIndex
CREATE UNIQUE INDEX "ParsedPaper_userId_hash_key" ON "ParsedPaper"("userId", "hash");

-- CreateIndex
CREATE UNIQUE INDEX "Prerequisites_reviewId_key" ON "Prerequisites"("reviewId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewAnnotations_reviewId_key" ON "ReviewAnnotations"("reviewId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewMessages_reviewId_key" ON "ReviewMessages"("reviewId");

-- CreateIndex
CREATE UNIQUE INDEX "Setting_userId_key_key" ON "Setting"("userId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "WikiBacklink_sourceId_targetSlug_key" ON "WikiBacklink"("sourceId", "targetSlug");

-- CreateIndex
CREATE UNIQUE INDEX "WikiPageSource_pageId_reviewId_key" ON "WikiPageSource"("pageId", "reviewId");
