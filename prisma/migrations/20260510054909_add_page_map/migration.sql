-- CreateTable
CREATE TABLE "PageMap" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "map" JSONB NOT NULL,

    CONSTRAINT "PageMap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PageMap_userId_hash_key" ON "PageMap"("userId", "hash");

-- AddForeignKey
ALTER TABLE "PageMap" ADD CONSTRAINT "PageMap_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
