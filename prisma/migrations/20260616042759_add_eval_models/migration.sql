-- CreateEnum
CREATE TYPE "EvalRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "EvalPredictionOutcome" AS ENUM ('CORRECT', 'INCORRECT', 'UNPARSED', 'ERROR');

-- CreateTable
CREATE TABLE "EvalBenchmark" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvalBenchmark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recipe" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvalBenchmarkRun" (
    "id" TEXT NOT NULL,
    "evalBenchmarkId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "status" "EvalRunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvalBenchmarkRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvalBenchmarkRunResult" (
    "id" TEXT NOT NULL,
    "evalBenchmarkRunId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "breakdown" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvalBenchmarkRunResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvalBenchmarkRunItem" (
    "id" TEXT NOT NULL,
    "evalBenchmarkRunId" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "targetMetadata" JSONB,
    "prediction" TEXT NOT NULL,
    "predictionMetadata" JSONB,
    "predictionOutcome" "EvalPredictionOutcome" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvalBenchmarkRunItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EvalBenchmark_name_key" ON "EvalBenchmark"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Recipe_name_key" ON "Recipe"("name");

-- CreateIndex
CREATE INDEX "EvalBenchmarkRun_evalBenchmarkId_createdAt_idx" ON "EvalBenchmarkRun"("evalBenchmarkId", "createdAt");

-- CreateIndex
CREATE INDEX "EvalBenchmarkRun_recipeId_idx" ON "EvalBenchmarkRun"("recipeId");

-- CreateIndex
CREATE UNIQUE INDEX "EvalBenchmarkRunResult_evalBenchmarkRunId_metric_key" ON "EvalBenchmarkRunResult"("evalBenchmarkRunId", "metric");

-- CreateIndex
CREATE INDEX "EvalBenchmarkRunItem_evalBenchmarkRunId_predictionOutcome_idx" ON "EvalBenchmarkRunItem"("evalBenchmarkRunId", "predictionOutcome");

-- CreateIndex
CREATE UNIQUE INDEX "EvalBenchmarkRunItem_evalBenchmarkRunId_itemKey_key" ON "EvalBenchmarkRunItem"("evalBenchmarkRunId", "itemKey");

-- AddForeignKey
ALTER TABLE "EvalBenchmarkRun" ADD CONSTRAINT "EvalBenchmarkRun_evalBenchmarkId_fkey" FOREIGN KEY ("evalBenchmarkId") REFERENCES "EvalBenchmark"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvalBenchmarkRun" ADD CONSTRAINT "EvalBenchmarkRun_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvalBenchmarkRunResult" ADD CONSTRAINT "EvalBenchmarkRunResult_evalBenchmarkRunId_fkey" FOREIGN KEY ("evalBenchmarkRunId") REFERENCES "EvalBenchmarkRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvalBenchmarkRunItem" ADD CONSTRAINT "EvalBenchmarkRunItem_evalBenchmarkRunId_fkey" FOREIGN KEY ("evalBenchmarkRunId") REFERENCES "EvalBenchmarkRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
