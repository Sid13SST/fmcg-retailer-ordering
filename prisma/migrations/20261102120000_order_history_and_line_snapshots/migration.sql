-- AlterTable
ALTER TABLE "Order" ADD COLUMN "clientRequestId" TEXT;

-- CreateTable
CREATE TABLE "OrderStatusEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderStatusEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_OrderLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "skuCode" TEXT NOT NULL,
    "skuName" TEXT NOT NULL,
    "caseSize" INTEGER NOT NULL,
    "gstRatePercent" INTEGER NOT NULL,
    "qtyCases" INTEGER NOT NULL,
    "unitPricePaise" INTEGER NOT NULL,
    "freeCases" INTEGER NOT NULL DEFAULT 0,
    "discountPercent" REAL NOT NULL DEFAULT 0,
    "discountPaise" INTEGER NOT NULL DEFAULT 0,
    "subtotalPaise" INTEGER NOT NULL,
    "gstPaise" INTEGER NOT NULL,
    "totalPaise" INTEGER NOT NULL,
    "schemeLabel" TEXT,
    CONSTRAINT "OrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrderLine_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "SKU" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
-- Backfill line snapshots from the SKU table for existing rows.
INSERT INTO "new_OrderLine" ("discountPaise", "discountPercent", "freeCases", "gstPaise", "id", "orderId", "qtyCases", "schemeLabel", "skuId", "subtotalPaise", "totalPaise", "unitPricePaise", "skuCode", "skuName", "caseSize", "gstRatePercent")
SELECT l."discountPaise", l."discountPercent", l."freeCases", l."gstPaise", l."id", l."orderId", l."qtyCases", l."schemeLabel", l."skuId", l."subtotalPaise", l."totalPaise", l."unitPricePaise", s."code", s."name", s."caseSize", s."gstRatePercent"
FROM "OrderLine" l JOIN "SKU" s ON s."id" = l."skuId";
DROP TABLE "OrderLine";
ALTER TABLE "new_OrderLine" RENAME TO "OrderLine";
CREATE INDEX "OrderLine_orderId_idx" ON "OrderLine"("orderId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "OrderStatusEvent_orderId_createdAt_idx" ON "OrderStatusEvent"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_clientRequestId_key" ON "Order"("clientRequestId");

