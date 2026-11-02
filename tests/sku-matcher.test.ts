import { describe, expect, it } from "vitest";
import { MATCH_THRESHOLDS, aliasPhraseFor, confidenceFor, matchPhrase, scoreCandidates } from "@/lib/sku-matcher";
import { seedContext } from "./capture-helpers";

describe("sku matcher — alternatives", () => {
  it("returns exactly two alternatives, best-scoring first (tea 250 -> tea 500 next)", () => {
    const r = matchPhrase("chai patti 250 wala", seedContext());
    expect(r.best?.code).toBe("SKU-TE-250");
    expect(r.alternatives).toHaveLength(2);
    expect(r.alternatives[0]!.code).toBe("SKU-TE-500");
    expect(r.alternatives[0]!.score).toBeGreaterThanOrEqual(r.alternatives[1]!.score);
  });

  it("orders alternatives by score, then in-stock, then same category, then order history", () => {
    // Marie and cream biscuit tie on words; this retailer's history decides the order.
    const plain = matchPhrase("biscuit chhota", seedContext());
    expect(plain.alternatives.map((a) => a.code)).toEqual(["SKU-BS-150", "SKU-CR-100"]);
    const withHistory = matchPhrase("biscuit chhota", seedContext({ history: { "SKU-CR-100": 4 } }));
    expect(withHistory.alternatives.map((a) => a.code)).toEqual(["SKU-CR-100", "SKU-BS-150"]);
  });

  it("an explicit size that conflicts lowers a candidate (1 kilo vs 500 g)", () => {
    const r = matchPhrase("washing powder 1 kilo", seedContext());
    expect(r.best?.code).toBe("SKU-DT-1KG");
    expect(r.alternatives[0]!.code).toBe("SKU-DT-500");
    expect(r.alternatives[0]!.score).toBeLessThan(r.best!.score - MATCH_THRESHOLDS.highMargin);
  });

  it("never pads alternatives with unrelated products", () => {
    const r = matchPhrase("nahane ka sabun", seedContext());
    expect(r.best?.code).toBe("SKU-SP-100");
    const brands = new Set(r.alternatives.map((a) => a.code));
    expect(brands.has("SKU-BS-075")).toBe(false);
  });

  it("unmatched words give null best, null confidence and only real suggestions", () => {
    const r = matchPhrase("xyz pqr", seedContext());
    expect(r).toMatchObject({ best: null, confidence: null, alternatives: [] });
    const near = matchPhrase("manjan bada", seedContext());
    expect(near.best).toBeNull();
    expect(near.alternatives.map((a) => a.code).sort()).toEqual(["SKU-TP-100", "SKU-TP-200"]);
  });
});

describe("sku matcher — evidence and confidence", () => {
  it("retailer-specific aliases outrank distributor-wide ones", () => {
    const ctx = seedContext({
      extraAliases: [{ phrase: "peti biscuit", skuId: "SKU-BS-150", retailerId: "me", usageCount: 1, source: "CORRECTED" }],
    });
    const r = matchPhrase("peti biscuit", ctx);
    expect(r.best).toMatchObject({ code: "SKU-BS-150", evidence: "RETAILER_ALIAS" });
    expect(r.learned).toEqual({ phrase: "peti biscuit", source: "CORRECTED" });
  });

  it("curated aliases do not show the 'learned' hint", () => {
    expect(matchPhrase("chhota biscuit", seedContext()).learned).toBeNull();
  });

  it("an ambiguous word ('biscuit') is not 'high' even with an alias", () => {
    const r = matchPhrase("biscuit", seedContext());
    expect(r.best?.code).toBe("SKU-BS-075");
    expect(r.confidence).toBe("medium");
  });

  it("matches catalogue names fuzzily, incl. Hinglish glossary and typos", () => {
    expect(matchPhrase("marie biskut", seedContext()).best?.code).toBe("SKU-BS-150");
    expect(matchPhrase("surf 500 g", seedContext()).best?.code).toBe("SKU-DT-500");
    // Only "साबुन" is a known Devanagari alias: a partial hit is proposed, but as "low".
    expect(matchPhrase("नहाने का साबुन", seedContext())).toMatchObject({ best: { code: "SKU-SP-100" }, confidence: "low" });
    expect(matchPhrase("साबुन", seedContext()).best?.code).toBe("SKU-SP-100");
  });

  it("an AI sku_guess nudges but cannot by itself create a confident match", () => {
    const guessed = scoreCandidates("xyz", seedContext(), "SKU-HD-500").find((c) => c.code === "SKU-HD-500")!;
    expect(guessed.evidence).toBe("AI_GUESS");
    expect(guessed.score).toBeLessThan(MATCH_THRESHOLDS.minBest);
  });

  it("confidence buckets are thresholds with a margin rule (heuristic, not probability)", () => {
    expect(confidenceFor(0.95, 0.5)).toBe("high");
    expect(confidenceFor(0.95, 0.8)).toBe("medium");
    expect(confidenceFor(0.7, 0)).toBe("medium");
    expect(confidenceFor(0.55, 0)).toBe("low");
  });

  it("alias phrases are stored normalized, without units or filler", () => {
    expect(aliasPhraseFor("Biscuit  Chhota!")).toBe("biscuit chhota");
    expect(aliasPhraseFor("bhaiya peti")).toBeNull();
  });
});
