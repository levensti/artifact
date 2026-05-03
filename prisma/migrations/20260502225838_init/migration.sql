-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("provider","providerAccountId")
);

-- CreateTable
CREATE TABLE "Session" (
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("sessionToken")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationToken_pkey" PRIMARY KEY ("identifier","token")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "arxivId" TEXT,
    "pdfPath" TEXT,
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "importedAt" TIMESTAMP(3),

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewMessages" (
    "reviewId" TEXT NOT NULL,
    "messages" JSONB NOT NULL,

    CONSTRAINT "ReviewMessages_pkey" PRIMARY KEY ("reviewId")
);

-- CreateTable
CREATE TABLE "ReviewAnnotations" (
    "reviewId" TEXT NOT NULL,
    "annotations" JSONB NOT NULL,

    CONSTRAINT "ReviewAnnotations_pkey" PRIMARY KEY ("reviewId")
);

-- CreateTable
CREATE TABLE "Prerequisites" (
    "reviewId" TEXT NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "Prerequisites_pkey" PRIMARY KEY ("reviewId")
);

-- CreateTable
CREATE TABLE "DeepDive" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "paperTitle" TEXT NOT NULL,
    "arxivId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeepDive_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WikiPage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "pageType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WikiPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WikiPageSource" (
    "userId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "passage" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WikiPageSource_pkey" PRIMARY KEY ("pageId","reviewId")
);

-- CreateTable
CREATE TABLE "WikiBacklink" (
    "userId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetSlug" TEXT NOT NULL,

    CONSTRAINT "WikiBacklink_pkey" PRIMARY KEY ("sourceId","targetSlug")
);

-- CreateTable
CREATE TABLE "WikiRevision" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "pageType" TEXT NOT NULL,
    "savedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WikiRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("userId","key")
);

-- CreateTable
CREATE TABLE "PdfBlob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT,
    "storagePath" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PdfBlob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParsedPaper" (
    "userId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "parsed" JSONB NOT NULL,

    CONSTRAINT "ParsedPaper_pkey" PRIMARY KEY ("userId","hash")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Review_userId_createdAt_idx" ON "Review"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Review_userId_arxivId_idx" ON "Review"("userId", "arxivId");

-- CreateIndex
CREATE INDEX "DeepDive_userId_createdAt_idx" ON "DeepDive"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "DeepDive_userId_reviewId_idx" ON "DeepDive"("userId", "reviewId");

-- CreateIndex
CREATE INDEX "WikiPage_userId_updatedAt_idx" ON "WikiPage"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "WikiPage_userId_pageType_idx" ON "WikiPage"("userId", "pageType");

-- CreateIndex
CREATE UNIQUE INDEX "WikiPage_userId_slug_key" ON "WikiPage"("userId", "slug");

-- CreateIndex
CREATE INDEX "WikiPageSource_userId_reviewId_idx" ON "WikiPageSource"("userId", "reviewId");

-- CreateIndex
CREATE INDEX "WikiBacklink_userId_targetSlug_idx" ON "WikiBacklink"("userId", "targetSlug");

-- CreateIndex
CREATE INDEX "WikiRevision_pageId_id_idx" ON "WikiRevision"("pageId", "id");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewMessages" ADD CONSTRAINT "ReviewMessages_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewAnnotations" ADD CONSTRAINT "ReviewAnnotations_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prerequisites" ADD CONSTRAINT "Prerequisites_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeepDive" ADD CONSTRAINT "DeepDive_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeepDive" ADD CONSTRAINT "DeepDive_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WikiPage" ADD CONSTRAINT "WikiPage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WikiPageSource" ADD CONSTRAINT "WikiPageSource_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WikiPageSource" ADD CONSTRAINT "WikiPageSource_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "WikiPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WikiPageSource" ADD CONSTRAINT "WikiPageSource_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WikiBacklink" ADD CONSTRAINT "WikiBacklink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WikiBacklink" ADD CONSTRAINT "WikiBacklink_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "WikiPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WikiRevision" ADD CONSTRAINT "WikiRevision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WikiRevision" ADD CONSTRAINT "WikiRevision_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "WikiPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Setting" ADD CONSTRAINT "Setting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PdfBlob" ADD CONSTRAINT "PdfBlob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParsedPaper" ADD CONSTRAINT "ParsedPaper_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
