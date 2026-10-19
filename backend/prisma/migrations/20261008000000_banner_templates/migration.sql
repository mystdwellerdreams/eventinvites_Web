-- CreateTable
CREATE TABLE "BannerTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "config" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BannerTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BannerTemplate_type_idx" ON "BannerTemplate"("type");
