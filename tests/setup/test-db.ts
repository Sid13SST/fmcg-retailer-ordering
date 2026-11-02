import path from "node:path";
import { PrismaClient } from "@prisma/client";

export const TEST_DATABASE_URL = `file:${path.resolve(__dirname, "../../prisma/test.db")}`;

export function createTestClient() {
  return new PrismaClient({ datasourceUrl: TEST_DATABASE_URL });
}

/** Wipe all rows (dependency order) so each test starts clean. */
export async function resetDb(db: PrismaClient) {
  await db.tallyExport.deleteMany();
  await db.orderStatusEvent.deleteMany();
  await db.aICapture.deleteMany();
  await db.orderLine.deleteMany();
  await db.order.deleteMany();
  await db.alias.deleteMany();
  await db.retailerPriceOverride.deleteMany();
  await db.scheme.deleteMany();
  await db.sKU.deleteMany();
  await db.retailer.deleteMany();
  await db.salesman.deleteMany();
  await db.deskUser.deleteMany();
}
