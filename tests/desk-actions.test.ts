import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { OfflineParserProvider } from "@/lib/ai-capture";
import { confirmCaptureSchema } from "@/lib/capture/confirm-schema";
import { confirmCapture, parseCapture } from "@/lib/capture/service";
import {
  approveOrder,
  correctOrderLine,
  exportOrderToTally,
  exportTodaysApproved,
  holdOrder,
  rejectOrder,
} from "@/lib/desk/actions";
import { createRetailerOrder } from "@/lib/orders/create-order";
import { placeOrderInputSchema } from "@/lib/orders/cart-schema";
import { createTestClient, resetDb } from "./setup/test-db";

const db = createTestClient();
afterAll(() => db.$disconnect());

const desk = { name: "Neha Sharma" };
const id: Record<string, string> = {};
let retailerId = "";

async function seed(limitPaise = 5_000_000, usedPaise = 0) {
  await resetDb(db);
  const r = await db.retailer.create({
    data: { name: "Ramesh Agrawal", shopName: "Agrawal Kirana Stores", phone: "9827000001", area: "Napier Town", creditLimitPaise: limitPaise, creditUsedPaise: usedPaise },
  });
  retailerId = r.id;
  for (const s of [
    { code: "SKU-BS-075", name: "Glucose biscuit 75 g", caseSize: 96, price: 810, stock: 340 },
    { code: "SKU-BS-150", name: "Marie biscuit 150 g", caseSize: 60, price: 1890, stock: 210 },
    { code: "SKU-DT-1KG", name: "Detergent powder 1 kg", caseSize: 20, price: 10150, stock: 85 },
  ]) {
    const row = await db.sKU.create({
      data: { code: s.code, name: s.name, brand: "Test", category: "Test", caseSize: s.caseSize, dealerPricePerCasePaise: s.price, gstRatePercent: 18, stockCases: s.stock },
    });
    id[s.code] = row.id;
  }
  await db.scheme.create({ data: { skuId: id["SKU-BS-075"]!, type: "BUY_X_GET_Y_FREE", thresholdCases: 10, freeCases: 1 } });
  await db.alias.create({ data: { phrase: "biscuit chhota", skuId: id["SKU-BS-150"]!, retailerId: null, usageCount: 3 } });
}

async function place(lines: Array<[string, number]>) {
  const res = await createRetailerOrder(
    db,
    retailerId,
    placeOrderInputSchema.parse({ clientRequestId: randomUUID(), lines: lines.map(([code, qtyCases]) => ({ skuId: id[code]!, qtyCases })) }),
  );
  if (!res.ok) throw new Error(res.code);
  return res;
}

const stock = async (code: string) => (await db.sKU.findUniqueOrThrow({ where: { id: id[code]! } })).stockCases;
const used = async () => (await db.retailer.findUniqueOrThrow({ where: { id: retailerId } })).creditUsedPaise;

describe("approve / hold / reject", () => {
  beforeEach(() => seed());

  it("approves a pending order and records who did it", async () => {
    const o = await place([["SKU-DT-1KG", 2]]);
    const res = await approveOrder(db, o.orderId, desk);
    expect(res).toMatchObject({ ok: true, status: "CONFIRMED" });
    const order = await db.order.findUniqueOrThrow({ where: { id: o.orderId }, include: { statusEvents: true } });
    expect(order.status).toBe("CONFIRMED");
    expect(order.approvedAt).not.toBeNull();
    expect(order.statusEvents.at(-1)).toMatchObject({ fromStatus: "PENDING_DESK_REVIEW", toStatus: "CONFIRMED", actorRole: "ORDER_DESK", actorName: "Neha Sharma" });
    expect(await used()).toBe(o.grandTotalPaise); // reserved once at placement, not again
  });

  it("an on-hold order needs an explicit confirm of the current shortfall, then reserves credit over the limit", async () => {
    await seed(10_000, 0); // Rs 100 limit
    const o = await place([["SKU-DT-1KG", 1]]); // Rs 119.77 incl. GST
    expect(o.status).toBe("ON_HOLD");
    const shortfall = o.grandTotalPaise - 10_000;

    const refused = await approveOrder(db, o.orderId, desk);
    expect(refused).toMatchObject({ ok: false, code: "CREDIT_CONFIRM_REQUIRED", shortfallPaise: shortfall });
    const stale = await approveOrder(db, o.orderId, desk, { confirmShortfallPaise: shortfall - 1 });
    expect(stale).toMatchObject({ ok: false, code: "CREDIT_CONFIRM_REQUIRED" });
    expect((await db.order.findUniqueOrThrow({ where: { id: o.orderId } })).status).toBe("ON_HOLD");

    const ok = await approveOrder(db, o.orderId, desk, { confirmShortfallPaise: shortfall });
    expect(ok).toMatchObject({ ok: true, overLimitByPaise: shortfall });
    expect(await used()).toBe(o.grandTotalPaise);
  });

  it("hold releases reserved credit; reject restores stock and credit", async () => {
    const o = await place([["SKU-BS-075", 10]]); // ships 11 incl. free
    expect(await stock("SKU-BS-075")).toBe(340 - 11);
    expect(await holdOrder(db, o.orderId, desk, "Check with salesman")).toMatchObject({ ok: true });
    expect(await used()).toBe(0);
    expect(await rejectOrder(db, o.orderId, desk, "Retailer cancelled by phone")).toMatchObject({ ok: true });
    expect(await stock("SKU-BS-075")).toBe(340);
    expect(await used()).toBe(0);
    const order = await db.order.findUniqueOrThrow({ where: { id: o.orderId } });
    expect(order).toMatchObject({ status: "REJECTED", rejectionReason: "Retailer cancelled by phone" });
  });

  it("enforces transitions server-side", async () => {
    const o = await place([["SKU-DT-1KG", 1]]);
    expect(await exportOrderToTally(db, o.orderId, desk)).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
    await rejectOrder(db, o.orderId, desk, "Duplicate order");
    expect(await approveOrder(db, o.orderId, desk)).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
    expect(await exportOrderToTally(db, o.orderId, desk)).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
    expect(await rejectOrder(db, o.orderId, desk, "again")).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
    expect(await db.tallyExport.count()).toBe(0);
  });
});

describe("correcting an AI-captured line", () => {
  beforeEach(() => seed());

  async function aiOrder() {
    const parsed = await parseCapture(db, retailerId, "5 peti biscuit chhota, 2 peti washing powder", { provider: new OfflineParserProvider() });
    if (!parsed.ok) throw new Error("parse failed");
    const lines = parsed.capture.lines.filter((l) => l.skuId);
    const res = await confirmCapture(
      db,
      retailerId,
      parsed.capture.captureId,
      confirmCaptureSchema.parse({
        clientRequestId: randomUUID(),
        lines: lines.map((l) => ({ lineId: l.id, skuId: l.skuId!, qtyCases: l.qty ?? 1, unitChoice: l.needsUnitChoice ? "CASE" : undefined })),
        removedLineIds: parsed.capture.lines.filter((l) => !l.skuId).map((l) => l.id),
      }),
    );
    if (!res.ok) throw new Error(res.code);
    return db.order.findUniqueOrThrow({ where: { id: res.orderId }, include: { lines: true } });
  }

  it("swapping the SKU reprices, moves stock, learns the retailer alias and is audited", async () => {
    const order = await aiOrder();
    const line = order.lines.find((l) => l.skuCode === "SKU-BS-150")!;
    expect(line.sourcePhrase).toContain("biscuit chhota");

    const res = await correctOrderLine(db, order.id, desk, { lineId: line.id, skuId: id["SKU-BS-075"]!, qtyCases: 10 });
    expect(res).toMatchObject({ ok: true, status: "PENDING_DESK_REVIEW", aliasPhrase: "biscuit chhota" });

    const after = await db.order.findUniqueOrThrow({ where: { id: order.id }, include: { lines: true, lineCorrections: true } });
    const fixed = after.lines.find((l) => l.id === line.id)!;
    expect(fixed).toMatchObject({ skuCode: "SKU-BS-075", qtyCases: 10, freeCases: 1, unitPricePaise: 810, sourcePhrase: line.sourcePhrase });
    expect(after.grandTotalPaise).toBe(after.lines.reduce((s, l) => s + l.totalPaise, 0));
    expect(await stock("SKU-BS-150")).toBe(210);
    expect(await stock("SKU-BS-075")).toBe(340 - 11);
    expect(await used()).toBe(after.grandTotalPaise);

    expect(after.lineCorrections).toEqual([
      expect.objectContaining({ actorName: "Neha Sharma", fromSkuCode: "SKU-BS-150", toSkuCode: "SKU-BS-075", fromQtyCases: 5, toQtyCases: 10, aliasPhrase: "biscuit chhota" }),
    ]);
    const alias = await db.alias.findUniqueOrThrow({ where: { retailerId_phrase: { retailerId, phrase: "biscuit chhota" } } });
    expect(alias).toMatchObject({ skuId: id["SKU-BS-075"], source: "CORRECTED" });

    // The next text order from this retailer maps the phrase to the corrected SKU.
    const next = await parseCapture(db, retailerId, "3 peti biscuit chhota", { provider: new OfflineParserProvider() });
    expect(next.ok && next.capture.lines[0]!.skuId).toBe(id["SKU-BS-075"]);
  });

  it("refuses a correction that stock cannot ship and leaves everything unchanged", async () => {
    const order = await aiOrder();
    const line = order.lines.find((l) => l.skuCode === "SKU-BS-150")!;
    const res = await correctOrderLine(db, order.id, desk, { lineId: line.id, qtyCases: 500 });
    expect(res).toMatchObject({ ok: false, code: "INSUFFICIENT_STOCK" });
    expect(await stock("SKU-BS-150")).toBe(210 - 5);
    expect(await db.orderLineCorrection.count()).toBe(0);
  });

  it("a correction that pushes a pending order over credit puts it on hold", async () => {
    const order = await aiOrder();
    await db.retailer.update({ where: { id: retailerId }, data: { creditLimitPaise: order.grandTotalPaise + 100 } });
    const line = order.lines.find((l) => l.skuCode === "SKU-DT-1KG")!;
    const res = await correctOrderLine(db, order.id, desk, { lineId: line.id, qtyCases: 5 });
    expect(res).toMatchObject({ ok: true, status: "ON_HOLD" });
    const after = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.creditShortfallPaise).toBe(after.grandTotalPaise - (order.grandTotalPaise + 100));
    expect(await used()).toBe(0);
  });
});

describe("Tally export (mocked)", () => {
  beforeEach(() => seed());

  it("exports an approved order once, stores the payload and marks it EXPORTED", async () => {
    const o = await place([["SKU-BS-075", 10]]);
    await approveOrder(db, o.orderId, desk);
    const res = await exportOrderToTally(db, o.orderId, desk);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.csv.split("\r\n")[0]).toBe("Voucher Type,Voucher No,Date,Debtor/Retailer,Item,Qty,Rate,Discount,Amount,GST,Ledger");
    expect(res.csv).toContain("10 Case,8.10,0.00,81.00,14.58,Sales @ 18% GST");
    const row = await db.tallyExport.findFirstOrThrow({ where: { orderId: o.orderId } });
    expect(row).toMatchObject({ csvPayload: res.csv, exportedBy: "Neha Sharma", batchId: null });
    expect((await db.order.findUniqueOrThrow({ where: { id: o.orderId } })).status).toBe("EXPORTED");
    expect(await exportOrderToTally(db, o.orderId, desk)).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
  });

  it("bulk-exports only today's approved orders into one CSV", async () => {
    const a = await place([["SKU-DT-1KG", 1]]);
    const b = await place([["SKU-BS-150", 2]]);
    const c = await place([["SKU-BS-075", 1]]);
    await approveOrder(db, a.orderId, desk);
    await approveOrder(db, b.orderId, desk);
    await approveOrder(db, c.orderId, desk);
    // c was approved on an earlier day: not part of today's batch.
    await db.order.update({ where: { id: c.orderId }, data: { approvedAt: new Date(Date.now() - 3 * 24 * 3600 * 1000) } });

    const res = await exportTodaysApproved(db, desk);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.orderNumbers).toEqual([a.orderNumber, b.orderNumber]);
    expect(res.csv.trimEnd().split("\r\n")).toHaveLength(3);
    const rows = await db.tallyExport.findMany({ where: { batchId: res.batchId } });
    expect(rows).toHaveLength(2);
    expect((await db.order.findUniqueOrThrow({ where: { id: c.orderId } })).status).toBe("CONFIRMED");
    expect(await exportTodaysApproved(db, desk)).toMatchObject({ ok: false, code: "NOTHING_TO_EXPORT" });
  });
});
