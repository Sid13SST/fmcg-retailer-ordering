import { describe, expect, it } from "vitest";
import { OfflineParserProvider, parseSegment, splitSegments } from "@/lib/ai-capture";
import { buildCaptureLines } from "@/lib/capture/pipeline";
import { BRIEF_SAMPLE_ORDER_MESSAGE } from "@/prisma/seed-data";
import { seedContext } from "./capture-helpers";

const parser = new OfflineParserProvider();
const extract = async (text: string) => (await parser.extract(text)).lines;

describe("offline parser — brief sample message", () => {
  it("reads biscuit 5 cases, detergent 2 cases, tea 1 case and flags tea out of stock", async () => {
    const result = await parser.extract(BRIEF_SAMPLE_ORDER_MESSAGE);
    expect(result.engine).toBe("OFFLINE");
    expect(result.model).toBeNull();

    const cards = buildCaptureLines(result.lines, seedContext());
    expect(cards.map((c) => [c.skuId, c.qty, c.unit])).toEqual([
      ["SKU-BS-075", 5, "CASE"],
      ["SKU-DT-1KG", 2, "CASE"],
      ["SKU-TE-250", 1, "CASE"],
    ]);
    // Every line keeps the retailer's own words.
    expect(cards.map((c) => c.rawPhrase)).toEqual([
      "bhaiya 5 peti biscuit chhota",
      "2 peti washing powder 1 kilo",
      "chai patti 250 wala 1 peti",
    ]);
    expect(cards.map((c) => c.outOfStock)).toEqual([false, false, true]);
    expect(cards.every((c) => c.confidence === "high" && !c.needsUnitChoice && !c.needsQty)).toBe(true);
    // Each matched line offers exactly two alternatives.
    expect(cards.every((c) => c.alternativeSkuIds.length === 2)).toBe(true);
  });

  it("treats '1 kilo' and '250 wala' as pack sizes, not quantities", () => {
    expect(parseSegment("2 peti washing powder 1 kilo")).toMatchObject({ qty: 2, productText: "washing powder 1 kilo" });
    expect(parseSegment("chai patti 250 wala 1 peti")).toMatchObject({ qty: 1, productText: "chai patti 250 wala" });
  });
});

describe("offline parser — Hindi and English number words", () => {
  it.each([
    ["paanch peti biscuit", 5],
    ["do peti bhujia", 2],
    ["teen case noodles", 3],
    ["ek peti chai patti", 1],
    ["das peti sabun", 10],
    ["five cases biscuit", 5],
    ["दो पेटी चाय पत्ती", 2],
    ["२ पेटी बिस्कुट", 2],
    ["5peti biscuit", 5],
  ])("%s -> qty %i in cases", (text, qty) => {
    expect(parseSegment(text)).toMatchObject({ qty, unit: "CASE" });
  });

  it("does not read the verb 'do' in 'bhej do' as the number 2", async () => {
    const [line] = await extract("surf bhej do");
    expect(line).toMatchObject({ qty: null, productText: "surf" });
  });

  it("splits on commas, 'aur' and run-on qty+unit pairs", async () => {
    expect(splitSegments("5 peti biscuit aur 2 peti bhujia")).toEqual(["5 peti biscuit", "2 peti bhujia"]);
    expect(splitSegments("5 peti biscuit 2 peti bhujia 1 peti sabun")).toEqual(["5 peti biscuit", "2 peti bhujia", "1 peti sabun"]);
    expect(splitSegments("biscuit 5 peti bhujia 2 peti")).toEqual(["biscuit 5 peti", "bhujia 2 peti"]);
    expect((await extract("bhaiya,\n5 peti biscuit")).length).toBe(1); // greeting-only segment dropped
  });
});

describe("offline parser — unit ambiguity is flagged, never guessed", () => {
  it("piece words (dabba, packet, piece) need a case-or-piece answer", async () => {
    const lines = await extract("3 dabba chai patti 250 wala, 10 packet shampoo pudiya, 4 piece bhujia");
    expect(lines.map((l) => l.unit)).toEqual(["PIECE", "PIECE", "PIECE"]);
    const cards = buildCaptureLines(lines, seedContext());
    expect(cards.every((c) => c.needsUnitChoice)).toBe(true);
    expect(cards.map((c) => c.qty)).toEqual([3, 10, 4]);
  });

  it("no unit word at all -> UNKNOWN unit, still asked", async () => {
    const [line] = await extract("biscuit chhota 5");
    expect(line).toMatchObject({ qty: 5, unit: "UNKNOWN" });
    expect(buildCaptureLines([line!], seedContext())[0]!.needsUnitChoice).toBe(true);
  });

  it("no quantity written -> qty null and the card asks (never assumes 1)", async () => {
    const [line] = await extract("peti biscuit");
    expect(line).toMatchObject({ qty: null, unit: "CASE" });
    expect(buildCaptureLines([line!], seedContext())[0]).toMatchObject({ needsQty: true, needsUnitChoice: false });
  });

  it("unknown products come back unmatched instead of forced onto a SKU", async () => {
    const cards = buildCaptureLines(await extract("2 peti xyz pqr"), seedContext());
    expect(cards[0]).toMatchObject({ skuId: null, confidence: null, rawPhrase: "2 peti xyz pqr" });
  });
});
