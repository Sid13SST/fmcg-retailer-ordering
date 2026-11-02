import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AiExtractionError, OfflineParserProvider, type ExtractionProvider } from "@/lib/ai-capture";
import { confirmCaptureSchema } from "@/lib/capture/confirm-schema";
import { confirmCapture, parseCapture, type CaptureView } from "@/lib/capture/service";
import { BRIEF_SAMPLE_ORDER_MESSAGE } from "@/prisma/seed-data";
import { createTestClient, resetDb } from "./setup/test-db";

const db = createTestClient();
afterAll(() => db.$disconnect());

const offline = new OfflineParserProvider();
let retailerId = "";
const id: Record<string, string> = {};

async function seed() {
  await resetDb(db);
  const r = await db.retailer.create({
    data: { name: "Ramesh Agrawal", shopName: "Agrawal Kirana Stores", phone: "9827000001", area: "Napier Town", creditLimitPaise: 5_000_000, creditUsedPaise: 0 },
  });
  retailerId = r.id;
  const skus = [
    { code: "SKU-BS-075", name: "Glucose biscuit 75 g", category: "Biscuits", caseSize: 96, price: 810, gst: 18, stock: 340 },
    { code: "SKU-BS-150", name: "Marie biscuit 150 g", category: "Biscuits", caseSize: 60, price: 1890, gst: 18, stock: 210 },
    { code: "SKU-DT-1KG", name: "Detergent powder 1 kg", category: "Detergent", caseSize: 20, price: 10150, gst: 18, stock: 85 },
    { code: "SKU-DT-500", name: "Detergent powder 500 g", category: "Detergent", caseSize: 40, price: 5250, gst: 18, stock: 140 },
    { code: "SKU-TE-250", name: "Tea leaf 250 g", category: "Tea", caseSize: 40, price: 11800, gst: 5, stock: 0 },
    { code: "SKU-TE-500", name: "Tea leaf 500 g", category: "Tea", caseSize: 24, price: 22900, gst: 5, stock: 48 },
  ];
  for (const s of skus) {
    const row = await db.sKU.create({
      data: { code: s.code, name: s.name, brand: "Test", category: s.category, caseSize: s.caseSize, dealerPricePerCasePaise: s.price, gstRatePercent: s.gst, stockCases: s.stock },
    });
    id[s.code] = row.id;
  }
  await db.scheme.create({ data: { skuId: id["SKU-BS-075"]!, type: "BUY_X_GET_Y_FREE", thresholdCases: 10, freeCases: 1 } });
  await db.scheme.create({ data: { skuId: id["SKU-DT-1KG"]!, type: "SLAB_PERCENT_OFF", thresholdCases: 5, percentOff: 3 } });
  for (const [phrase, code] of [
    ["biscuit chhota", "SKU-BS-075"],
    ["washing powder 1 kilo", "SKU-DT-1KG"],
    ["chai patti 250 wala", "SKU-TE-250"],
  ] as const) {
    await db.alias.create({ data: { phrase, skuId: id[code]!, retailerId: null, usageCount: 5 } });
  }
}

async function parse(text: string, provider: ExtractionProvider = offline): Promise<CaptureView> {
  const res = await parseCapture(db, retailerId, text, { provider });
  if (!res.ok) throw new Error(res.message);
  return res.capture;
}

function confirmInput(lines: Array<{ lineId: string; skuId: string; qtyCases: number; unitChoice?: "CASE" | "PIECES" }>, removedLineIds: string[] = [], shortagePolicy: "REJECT" | "SHORT_CONFIRM" = "REJECT") {
  return confirmCaptureSchema.parse({ clientRequestId: randomUUID(), lines, removedLineIds, shortagePolicy });
}

describe("capture service — parse and store", () => {
  beforeEach(seed);

  it("stores a PARSED AICapture with raw text and full parsed JSON, and places no order", async () => {
    const cap = await parse(BRIEF_SAMPLE_ORDER_MESSAGE);
    expect(cap.engine).toBe("OFFLINE");
    expect(cap.engineLabel).toBe("Offline parser - no AI key configured");
    expect(cap.lines.map((l) => l.skuId)).toEqual([id["SKU-BS-075"], id["SKU-DT-1KG"], id["SKU-TE-250"]]);
    expect(cap.lines[2]!.outOfStock).toBe(true);

    const row = await db.aICapture.findUniqueOrThrow({ where: { id: cap.captureId } });
    expect(row).toMatchObject({ status: "PARSED", engine: "OFFLINE", rawText: BRIEF_SAMPLE_ORDER_MESSAGE, confirmedOrderId: null });
    expect(JSON.parse(row.parsedJson!).lines).toHaveLength(3);
    expect(await db.order.count()).toBe(0);
  });

  it("records an AI failure honestly as FAILED with the reason and no lines", async () => {
    const failing: ExtractionProvider = {
      engine: "GEMINI",
      extract: async () => {
        throw new AiExtractionError("INVALID_OUTPUT", "Gemini returned invalid output twice (Response is not valid JSON.).");
      },
    };
    const res = await parseCapture(db, retailerId, "5 peti biscuit", { provider: failing });
    expect(res).toMatchObject({ ok: false, code: "AI_FAILED", engineLabel: "AI (Gemini)" });
    const row = await db.aICapture.findFirstOrThrow({ where: { retailerId } });
    expect(row).toMatchObject({ status: "FAILED", engine: "GEMINI", parsedJson: null });
    expect(row.errorMessage).toMatch(/invalid output twice/);
  });
});

describe("capture service — confirm", () => {
  beforeEach(seed);

  it("creates an AI_TEXT order through the normal pipeline and learns aliases", async () => {
    const cap = await parse(BRIEF_SAMPLE_ORDER_MESSAGE);
    const [b, d, t] = cap.lines;
    // Tea 250 is out of stock: the retailer swaps to tea 500 (a correction).
    const res = await confirmCapture(
      db,
      retailerId,
      cap.captureId,
      confirmInput([
        { lineId: b!.id, skuId: id["SKU-BS-075"]!, qtyCases: 10 },
        { lineId: d!.id, skuId: id["SKU-DT-1KG"]!, qtyCases: 5 },
        { lineId: t!.id, skuId: id["SKU-TE-500"]!, qtyCases: 1 },
      ]),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const order = await db.order.findUniqueOrThrow({ where: { id: res.orderId }, include: { lines: true } });
    expect(order.source).toBe("AI_TEXT");
    expect(order.status).toBe("PENDING_DESK_REVIEW");
    // Same scheme engine as checkout: buy 10 get 1 on biscuit, 3% slab on detergent.
    const byCode = Object.fromEntries(order.lines.map((l) => [l.skuCode, l]));
    expect(byCode["SKU-BS-075"]!.freeCases).toBe(1);
    expect(byCode["SKU-DT-1KG"]!.discountPercent).toBe(3);
    // The retailer's original words stay on each line for desk review.
    expect(byCode["SKU-TE-500"]).toMatchObject({ sourcePhrase: "chai patti 250 wala 1 peti", sourceProductText: "chai patti 250 wala" });
    expect(byCode["SKU-BS-075"]!.sourceProductText).toBe("biscuit chhota");
    // Stock reserved incl. free goods (A4, A11).
    expect((await db.sKU.findUniqueOrThrow({ where: { id: id["SKU-BS-075"]! } })).stockCases).toBe(340 - 11);

    const capture = await db.aICapture.findUniqueOrThrow({ where: { id: cap.captureId } });
    expect(capture).toMatchObject({ status: "CONFIRMED", confirmedOrderId: order.id });
    const outcome = JSON.parse(capture.outcomeJson!);
    expect(outcome.lines.find((l: { lineId: string }) => l.lineId === t!.id)).toMatchObject({ corrected: true, rawPhrase: "chai patti 250 wala 1 peti" });

    const learned = await db.alias.findMany({ where: { retailerId }, include: { sku: true }, orderBy: { phrase: "asc" } });
    expect(learned.map((a) => [a.phrase, a.sku.code, a.source])).toEqual([
      ["biscuit chhota", "SKU-BS-075", "CONFIRMED"],
      ["chai patti 250 wala", "SKU-TE-500", "CORRECTED"],
      ["washing powder 1 kilo", "SKU-DT-1KG", "CONFIRMED"],
    ]);
  });

  it("a correction improves the next capture and shows the learned hint", async () => {
    const first = await parse("2 peti biscuit chhota");
    await confirmCapture(db, retailerId, first.captureId, confirmInput([{ lineId: "l1", skuId: id["SKU-BS-150"]!, qtyCases: 2 }]));
    const next = await parse("3 peti biscuit chhota");
    expect(next.lines[0]).toMatchObject({ skuId: id["SKU-BS-150"], evidence: "RETAILER_ALIAS", learned: { phrase: "biscuit chhota", source: "CORRECTED" } });
  });

  it("refuses lines with an unclear unit unless the retailer chose one", async () => {
    const cap = await parse("3 dabba biscuit chhota");
    expect(cap.lines[0]!.needsUnitChoice).toBe(true);
    const refused = await confirmCapture(db, retailerId, cap.captureId, confirmInput([{ lineId: "l1", skuId: id["SKU-BS-075"]!, qtyCases: 1 }]));
    expect(refused).toMatchObject({ ok: false, code: "INCOMPLETE_REVIEW", lineIds: ["l1"] });
    expect(await db.order.count()).toBe(0);

    const ok = await confirmCapture(db, retailerId, cap.captureId, confirmInput([{ lineId: "l1", skuId: id["SKU-BS-075"]!, qtyCases: 1, unitChoice: "PIECES" }]));
    expect(ok.ok).toBe(true);
  });

  it("refuses when a parsed line is neither confirmed nor explicitly removed", async () => {
    const cap = await parse("5 peti biscuit chhota, 2 peti washing powder 1 kilo");
    const res = await confirmCapture(db, retailerId, cap.captureId, confirmInput([{ lineId: "l1", skuId: id["SKU-BS-075"]!, qtyCases: 5 }]));
    expect(res).toMatchObject({ ok: false, code: "INCOMPLETE_REVIEW", lineIds: ["l2"] });
    const removed = await confirmCapture(db, retailerId, cap.captureId, confirmInput([{ lineId: "l1", skuId: id["SKU-BS-075"]!, qtyCases: 5 }], ["l2"]));
    expect(removed.ok).toBe(true);
  });

  it("an out-of-stock line is rejected unless the retailer accepts short-confirm (A12)", async () => {
    const cap = await parse(BRIEF_SAMPLE_ORDER_MESSAGE);
    const lines = cap.lines.map((l) => ({ lineId: l.id, skuId: l.skuId!, qtyCases: l.qty! }));
    const rejected = await confirmCapture(db, retailerId, cap.captureId, confirmInput(lines));
    expect(rejected).toMatchObject({ ok: false, code: "STOCK_CONFLICT" });
    const accepted = await confirmCapture(db, retailerId, cap.captureId, confirmInput(lines, [], "SHORT_CONFIRM"));
    expect(accepted.ok).toBe(true);
    if (accepted.ok) expect(accepted.adjustments.map((a) => a.skuCode)).toEqual(["SKU-TE-250"]);
  });

  it("a capture confirms once; the same request retried returns the same order", async () => {
    const cap = await parse("5 peti biscuit chhota");
    const input = confirmInput([{ lineId: "l1", skuId: id["SKU-BS-075"]!, qtyCases: 5 }]);
    const first = await confirmCapture(db, retailerId, cap.captureId, input);
    const retry = await confirmCapture(db, retailerId, cap.captureId, input);
    expect(first.ok && retry.ok && retry.duplicate && retry.orderId === first.orderId).toBe(true);
    const other = await confirmCapture(db, retailerId, cap.captureId, confirmInput([{ lineId: "l1", skuId: id["SKU-BS-075"]!, qtyCases: 5 }]));
    expect(other).toMatchObject({ ok: false, code: "CAPTURE_CLOSED" });
    expect(await db.order.count()).toBe(1);
  });

  it("another retailer cannot confirm someone else's capture", async () => {
    const cap = await parse("5 peti biscuit chhota");
    const intruder = await db.retailer.create({
      data: { name: "X", shopName: "X", phone: "9827000099", area: "X", creditLimitPaise: 100, creditUsedPaise: 0 },
    });
    const res = await confirmCapture(db, intruder.id, cap.captureId, confirmInput([{ lineId: "l1", skuId: id["SKU-BS-075"]!, qtyCases: 5 }]));
    expect(res).toMatchObject({ ok: false, code: "CAPTURE_NOT_FOUND" });
  });
});
