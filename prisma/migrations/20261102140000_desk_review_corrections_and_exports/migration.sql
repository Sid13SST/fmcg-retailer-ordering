-- AlterTable
ALTER TABLE "Order" ADD COLUMN "approvedAt" DATETIME;
ALTER TABLE "Order" ADD COLUMN "exportedAt" DATETIME;
ALTER TABLE "Order" ADD COLUMN "rejectionReason" TEXT;

-- AlterTable
ALTER TABLE "OrderLine" ADD COLUMN "sourcePhrase" TEXT;
ALTER TABLE "OrderLine" ADD COLUMN "sourceProductText" TEXT;

-- AlterTable
ALTER TABLE "OrderStatusEvent" ADD COLUMN "actorName" TEXT;

-- AlterTable
ALTER TABLE "TallyExport" ADD COLUMN "batchId" TEXT;
ALTER TABLE "TallyExport" ADD COLUMN "exportedBy" TEXT;

-- CreateTable
CREATE TABLE "OrderLineCorrection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "fromSkuCode" TEXT NOT NULL,
    "toSkuCode" TEXT NOT NULL,
    "fromQtyCases" INTEGER NOT NULL,
    "toQtyCases" INTEGER NOT NULL,
    "aliasPhrase" TEXT,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderLineCorrection_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrderLineCorrection_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "OrderLineCorrection_orderId_createdAt_idx" ON "OrderLineCorrection"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "TallyExport_batchId_idx" ON "TallyExport"("batchId");
