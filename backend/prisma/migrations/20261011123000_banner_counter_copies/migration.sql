-- CreateTable
CREATE TABLE "BannerCounterCopy" (
    "id" TEXT NOT NULL,
    "adId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BannerCounterCopy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BannerCounterCopy_adId_userId_reference_key" ON "BannerCounterCopy"("adId", "userId", "reference");

-- CreateIndex
CREATE INDEX "BannerCounterCopy_adId_idx" ON "BannerCounterCopy"("adId");
