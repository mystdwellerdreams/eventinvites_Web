-- CreateTable
CREATE TABLE "BannerSlot" (
    "id" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "interval" INTEGER NOT NULL DEFAULT 5,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BannerSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BannerAd" (
    "id" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "type" TEXT NOT NULL,
    "config" TEXT NOT NULL DEFAULT '{}',
    "duration" INTEGER NOT NULL DEFAULT 5,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BannerAd_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BannerPollVote" (
    "id" TEXT NOT NULL,
    "adId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BannerPollVote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BannerSlot_slot_key" ON "BannerSlot"("slot");

-- CreateIndex
CREATE INDEX "BannerAd_slotId_order_idx" ON "BannerAd"("slotId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "BannerPollVote_adId_userId_key" ON "BannerPollVote"("adId", "userId");

-- CreateIndex
CREATE INDEX "BannerPollVote_adId_optionId_idx" ON "BannerPollVote"("adId", "optionId");

-- AddForeignKey
ALTER TABLE "BannerAd" ADD CONSTRAINT "BannerAd_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "BannerSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
