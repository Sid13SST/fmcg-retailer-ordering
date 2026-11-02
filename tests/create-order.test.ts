import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createRetailerOrder } from "@/lib/orders/create-order";
import { placeOrderInputSchema } from "@/lib/orders/cart-schema";
import { quoteCart } from "@/lib/orders/quote";
import { createTestClient, resetDb } from "./setup/test-db";

const db = createTestClient();
afterAll(() => db.$disconnect());

let retailerId = "";
const sku: Record<"biscuit" | "detergent" | "tea", string> = { biscuit: "", detergent: "", tea: "" };

async function seedMinimal({ limitPaise = 5_000_000, usedPaise = 0, biscuitStock = 340, detergentStock = 85 } = {}) {
  await resetDb(db);
  const r = await db.retailer.create({
    data: { name: "Ramesh Agrawal", shopName: "Agrawal Kirana Stores", phone: "9827000001", area: "Napier Town", creditLimitPaise: limitPaise, creditUsedPaise: usedPaise },
  });
  retailerId = r.id;
  const b = await db.sKU.create({
    data: { code: "SKU-BS-075", name: "Glucose biscuit 75 g", brand: "Narmada Foods", category: "Biscuits", caseSize: 96, dealerPricePerCasePaise: 810, gstRatePercent: 18, stockCases: biscuitStock },
  });
  const d = await db.sKU.create({
    data: { code: "SKU-DT-1KG", name: "Detergent powder 1 kg", brand: "Shubh Home Care", category: "Detergent", caseSize: 20, dealerPricePerCasePaise: 10150, gstRatePercent: 18, stockCases: detergentStock },
  });
  const t = await db.sKU.create({
    data: { code: "SKU-TE-250", name: "Tea leaf 250 g", brand: "Satpura Beverages", category: "Tea", caseSize: 40, dealerPricePerCasePaise: 11800, gstRatePercent: 5, stockCases: 0 },
  });
  await db.scheme.create({ data: { skuId: b.id, type: "BUY_X_GET_Y_FREE", thresholdCases: 10, freeCases: 1 } });
  await db.scheme.create({ data: { skuId: d.id, type: "SLAB_PERCENT_OFF", thresholdCases: 5, percentOff: 3 } });
  // An inactive scheme must never apply.
  await db.scheme.create({ data: { skuId: t.id, type: "SLAB_PERCENT_OFF", thresholdCases: 1, percentOff: 50, active: false } });
  sku.biscuit = b.id;
  sku.detergent = d.id;
  sku.tea = t.id;
}

function input(lines: Array<[string, number]>, shortagePolicy: "REJECT" | "SHORT_CONFIRM" = "REJECT") {
  return placeOrderInputSchema.parse({
    lines: lines.map(([skuId, qtyCases]) => ({ skuId, qtyCases })),
    clientRequestId: randomUUID(),
    shortagePolicy,
  });
}

const stockOf = async (id: string) => (await db.sKU.findUniqueOrThrow({ where: { id } })).stockCases;

describe("createRetailerOrder — schemes end-to-end", () => {
  beforeEach(() => seedMinimal());

  it("prices a buy-10-get-1 line and a 5+ slab line, persists totals and lines", async () => {
    const res = await createRetailerOrder(db, retailerId, input([[sku.biscuit, 10], [sku.detergent, 5]]));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.status).toBe("PENDING_DESK_REVIEW");
    // biscuit: 8100 + 1458 GST = 9558; detergent: 50750 - 1523 = 49227 + 8861 GST = 58088
    expect(res.grandTotalPaise).toBe(9558 + 58088);

    const order = await db.order.findUniqueOrThrow({ where: { id: res.orderId }, include: { lines: true, statusEvents: true } });
    expect(order.subtotalPaise).toBe(8100 + 49227);
    expect(order.discountPaise).toBe(1523);
    expect(order.gstPaise).toBe(1458 + 8861);
    expect(order.grandTotalPaise).toBe(order.subtotalPaise + order.gstPaise);
    expect(order.source).toBe("CATALOG");
    expect(order.createdByRole).toBe("RETAILER");

    const biscuitLine = order.lines.find((l) => l.skuCode === "SKU-BS-075")!;
    expect(biscuitLine).toMatchObject({ qtyCases: 10, freeCases: 1, schemeLabel: "Buy 10 cases get 1 free", caseSize: 96, gstRatePercent: 18 });
    const detergentLine = order.lines.find((l) => l.skuCode === "SKU-DT-1KG")!;
    expect(detergentLine).toMatchObject({ qtyCases: 5, freeCases: 0, discountPercent: 3, discountPaise: 1523, totalPaise: 58088 });

    expect(order.statusEvents).toHaveLength(1);
    expect(order.statusEvents[0]).toMatchObject({ fromStatus: null, toStatus: "PENDING_DESK_REVIEW", actorRole: "RETAILER" });
  });

  it("quote and created order agree", async () => {
    const lines = input([[sku.biscuit, 20], [sku.detergent, 6]]);
    const quote = await quoteCart(db, retailerId, { lines: lines.lines });
    const res = await createRetailerOrder(db, retailerId, lines);
    expect(res.ok && res.grandTotalPaise).toBe(quote!.totals.grandTotalPaise);
  });
});

describe("createRetailerOrder — stock", () => {
  beforeEach(() => seedMinimal());

  it("decrements stock by ordered + free cases (A4)", async () => {
    await createRetailerOrder(db, retailerId, input([[sku.biscuit, 20], [sku.detergent, 5]]));
    expect(await stockOf(sku.biscuit)).toBe(340 - 22);
    expect(await stockOf(sku.detergent)).toBe(85 - 5);
  });

  it("never orders an out-of-stock SKU, under either policy", async () => {
    const rejected = await createRetailerOrder(db, retailerId, input([[sku.tea, 1], [sku.biscuit, 2]]));
    expect(rejected).toMatchObject({ ok: false, code: "STOCK_CONFLICT" });
    expect(await db.order.count()).toBe(0);
    expect(await stockOf(sku.biscuit)).toBe(340); // nothing written

    const onlyTea = await createRetailerOrder(db, retailerId, input([[sku.tea, 1]], "SHORT_CONFIRM"));
    expect(onlyTea).toMatchObject({ ok: false, code: "NOTHING_ORDERABLE" });

    const short = await createRetailerOrder(db, retailerId, input([[sku.tea, 1], [sku.biscuit, 2]], "SHORT_CONFIRM"));
    expect(short.ok).toBe(true);
    const lines = await db.orderLine.findMany();
    expect(lines.map((l) => l.skuCode)).toEqual(["SKU-BS-075"]);
    expect(await stockOf(sku.tea)).toBe(0);
  });

  it("REJECT policy returns the shortfall with the confirmable quantity", async () => {
    await seedMinimal({ biscuitStock: 10 });
    const res = await createRetailerOrder(db, retailerId, input([[sku.biscuit, 10]]));
    expect(res.ok).toBe(false);
    if (res.ok || res.code !== "STOCK_CONFLICT") throw new Error("expected conflict");
    // 10 ordered would ship 11 (1 free) but only 10 in stock -> 9 confirmable
    expect(res.issues[0]).toMatchObject({ skuCode: "SKU-BS-075", requestedCases: 10, availableCases: 9 });
    expect(await stockOf(sku.biscuit)).toBe(10);
  });

  it("SHORT_CONFIRM cuts the line to what stock allows and records a note", async () => {
    await seedMinimal({ detergentStock: 3 });
    const res = await createRetailerOrder(db, retailerId, input([[sku.detergent, 6]], "SHORT_CONFIRM"));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.adjustments[0]).toMatchObject({ requestedCases: 6, availableCases: 3 });
    const order = await db.order.findUniqueOrThrow({ where: { id: res.orderId }, include: { lines: true } });
    expect(order.lines[0]).toMatchObject({ qtyCases: 3, discountPercent: 0 }); // below 5-case slab now
    expect(order.notes).toContain("SKU-DT-1KG 6 → 3 cases");
    expect(await stockOf(sku.detergent)).toBe(0);
  });

  it("a second order cannot oversell stock left by the first", async () => {
    await seedMinimal({ detergentStock: 8 });
    const first = await createRetailerOrder(db, retailerId, input([[sku.detergent, 5]]));
    const second = await createRetailerOrder(db, retailerId, input([[sku.detergent, 5]]));
    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, code: "STOCK_CONFLICT" });
    expect(await stockOf(sku.detergent)).toBe(3);
  });

  it("rejects unknown SKUs without writing", async () => {
    const res = await createRetailerOrder(db, retailerId, input([["nope", 1]]));
    expect(res).toMatchObject({ ok: false, code: "UNKNOWN_SKU", skuIds: ["nope"] });
    expect(await db.order.count()).toBe(0);
  });
});

describe("createRetailerOrder — credit (A9, A10)", () => {
  it("within credit: PENDING_DESK_REVIEW and credit is reserved", async () => {
    await seedMinimal({ limitPaise: 100_000, usedPaise: 0 });
    const res = await createRetailerOrder(db, retailerId, input([[sku.biscuit, 10]])); // 9558
    expect(res).toMatchObject({ ok: true, status: "PENDING_DESK_REVIEW" });
    expect((await db.retailer.findUniqueOrThrow({ where: { id: retailerId } })).creditUsedPaise).toBe(9558);
  });

  it("exactly at available credit is accepted", async () => {
    await seedMinimal({ limitPaise: 20_000, usedPaise: 20_000 - 9558 });
    const res = await createRetailerOrder(db, retailerId, input([[sku.biscuit, 10]]));
    expect(res).toMatchObject({ ok: true, status: "PENDING_DESK_REVIEW" });
  });

  it("over credit: created ON_HOLD with shortfall, stock still reserved, credit not consumed", async () => {
    await seedMinimal({ limitPaise: 20_000, usedPaise: 20_000 - 9557 }); // 1 paise short
    const res = await createRetailerOrder(db, retailerId, input([[sku.biscuit, 10]]));
    expect(res).toMatchObject({ ok: true, status: "ON_HOLD" });
    if (!res.ok) return;
    expect(res.credit?.shortfallPaise).toBe(1);
    const order = await db.order.findUniqueOrThrow({ where: { id: res.orderId }, include: { statusEvents: true } });
    expect(order.status).toBe("ON_HOLD");
    expect(order.creditShortfallPaise).toBe(1);
    expect(order.holdReason).toContain("sent to desk for credit approval");
    expect(order.statusEvents[0]?.toStatus).toBe("ON_HOLD");
    expect(await stockOf(sku.biscuit)).toBe(340 - 11);
    expect((await db.retailer.findUniqueOrThrow({ where: { id: retailerId } })).creditUsedPaise).toBe(20_000 - 9557);
  });
});

describe("createRetailerOrder — idempotency and numbering", () => {
  beforeEach(() => seedMinimal());

  it("replaying the same clientRequestId returns the same order and does not double-decrement", async () => {
    const req = input([[sku.biscuit, 10]]);
    const a = await createRetailerOrder(db, retailerId, req);
    const b = await createRetailerOrder(db, retailerId, req);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(b.orderId).toBe(a.orderId);
    expect(b.duplicate).toBe(true);
    expect(await db.order.count()).toBe(1);
    expect(await stockOf(sku.biscuit)).toBe(340 - 11);
  });

  it("assigns sequential order numbers", async () => {
    const a = await createRetailerOrder(db, retailerId, input([[sku.biscuit, 1]]));
    const b = await createRetailerOrder(db, retailerId, input([[sku.biscuit, 1]]));
    expect(a.ok && a.orderNumber).toBe("KOD-00001");
    expect(b.ok && b.orderNumber).toBe("KOD-00002");
  });
});

describe("placeOrderInputSchema", () => {
  it("merges duplicate SKUs and rejects bad input", () => {
    const parsed = placeOrderInputSchema.parse({
      lines: [{ skuId: "a", qtyCases: 2 }, { skuId: "a", qtyCases: 3 }],
      clientRequestId: randomUUID(),
    });
    expect(parsed.lines).toEqual([{ skuId: "a", qtyCases: 5 }]);
    expect(parsed.shortagePolicy).toBe("REJECT");
    expect(placeOrderInputSchema.safeParse({ lines: [], clientRequestId: randomUUID() }).success).toBe(false);
    expect(placeOrderInputSchema.safeParse({ lines: [{ skuId: "a", qtyCases: 0 }], clientRequestId: randomUUID() }).success).toBe(false);
    expect(placeOrderInputSchema.safeParse({ lines: [{ skuId: "a", qtyCases: 1.5 }], clientRequestId: randomUUID() }).success).toBe(false);
    expect(placeOrderInputSchema.safeParse({ lines: [{ skuId: "a", qtyCases: 1 }], clientRequestId: "x" }).success).toBe(false);
  });
});
