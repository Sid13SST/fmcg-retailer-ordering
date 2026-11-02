import { execSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RETAILERS } from "@/prisma/seed-data";
import { createTestClient, resetDb, TEST_DATABASE_URL } from "./setup/test-db";

// Runs the real seed script against the test database and checks that the seeded credit
// state is what the app itself would have produced (A10).
const db = createTestClient();

beforeAll(() => {
  execSync("npx tsx prisma/seed.ts", { stdio: "pipe", env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL } });
}, 120_000);

afterAll(async () => {
  await resetDb(db);
  await db.$disconnect();
});

describe("seeded credit state (A10)", () => {
  it("reserves every PENDING order's total and nothing for ON_HOLD orders", async () => {
    const retailers = await db.retailer.findMany({ include: { orders: true } });
    expect(retailers).toHaveLength(RETAILERS.length);
    for (const r of retailers) {
      const seed = RETAILERS.find((s) => s.phone === r.phone)!;
      const pending = r.orders.filter((o) => o.status === "PENDING_DESK_REVIEW").reduce((sum, o) => sum + o.grandTotalPaise, 0);
      expect(r.creditUsedPaise, r.shopName).toBe(seed.usedRs * 100 + pending);
    }
  });

  it("keeps credit holds and the mis-mapped demo AI order", async () => {
    expect(await db.order.count({ where: { status: "ON_HOLD" } })).toBeGreaterThan(0);
    const demo = await db.order.findUnique({ where: { orderNumber: "KOD-00043" }, include: { retailer: true, lines: true } });
    expect(demo?.status).toBe("PENDING_DESK_REVIEW");
    expect(demo?.source).toBe("AI_TEXT");
    expect(demo?.retailer.shopName).toBe("Shri Ram Kirana");
    expect(demo?.lines.some((l) => l.sourceProductText === "biscuit bada" && l.skuCode === "SKU-BS-075")).toBe(true);
  });
});
