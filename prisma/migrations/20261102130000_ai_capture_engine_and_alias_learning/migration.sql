-- AlterTable
ALTER TABLE "AICapture" ADD COLUMN "engine" TEXT;
ALTER TABLE "AICapture" ADD COLUMN "errorMessage" TEXT;
ALTER TABLE "AICapture" ADD COLUMN "model" TEXT;
ALTER TABLE "AICapture" ADD COLUMN "outcomeJson" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Alias" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "retailerId" TEXT,
    "phrase" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "usageCount" INTEGER NOT NULL DEFAULT 1,
    "source" TEXT NOT NULL DEFAULT 'CURATED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Alias_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "Retailer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Alias_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "SKU" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Alias" ("createdAt", "id", "phrase", "retailerId", "skuId", "usageCount") SELECT "createdAt", "id", "phrase", "retailerId", "skuId", "usageCount" FROM "Alias";
DROP TABLE "Alias";
ALTER TABLE "new_Alias" RENAME TO "Alias";
CREATE INDEX "Alias_phrase_idx" ON "Alias"("phrase");
CREATE UNIQUE INDEX "Alias_retailerId_phrase_key" ON "Alias"("retailerId", "phrase");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
