/**
 * Pure capture pipeline: extracted lines + matcher context -> review cards.
 * No I/O, so the whole "text in, cards out" path is unit-testable offline.
 */
import type { ExtractedLine, ExtractionNote, LineUnit } from "@/lib/ai-capture";
import { matchPhrase, type Confidence, type Evidence, type MatchContext } from "@/lib/sku-matcher";

export interface CaptureLine {
  /** Stable id within a capture ("l1", "l2", ...), used on confirmation. */
  id: string;
  rawPhrase: string;
  productText: string;
  qty: number | null;
  unitWord: string | null;
  unit: LineUnit;
  notes: ExtractionNote[];
  /** Best SKU id, or null = "could not match" (resolve by manual search). */
  skuId: string | null;
  confidence: Confidence | null;
  evidence: Evidence;
  /** Alias phrase that produced the match, if any. */
  aliasPhrase: string | null;
  learned: { phrase: string; source: "CONFIRMED" | "CORRECTED" } | null;
  /** Two alternatives (or up to two suggestions when unmatched). */
  alternativeSkuIds: string[];
  /** Case vs piece is unclear: the retailer must choose before confirming. */
  needsUnitChoice: boolean;
  /** No quantity was written: the retailer must enter one. */
  needsQty: boolean;
  /** Best SKU has no stock at all. */
  outOfStock: boolean;
}

export function buildCaptureLines(lines: readonly ExtractedLine[], ctx: MatchContext): CaptureLine[] {
  const stock = new Map(ctx.skus.map((s) => [s.id, s.stockCases]));
  return lines.map((l, i) => {
    const m = matchPhrase(l.productText || l.rawPhrase, ctx, l.skuGuess);
    const skuId = m.best?.skuId ?? null;
    return {
      id: `l${i + 1}`,
      rawPhrase: l.rawPhrase,
      productText: l.productText,
      qty: l.qty,
      unitWord: l.unitWord,
      unit: l.unit,
      notes: l.notes,
      skuId,
      confidence: m.confidence,
      evidence: m.best?.evidence ?? "NONE",
      aliasPhrase: m.best?.aliasPhrase ?? null,
      learned: m.learned,
      alternativeSkuIds: m.alternatives.map((a) => a.skuId),
      needsUnitChoice: l.unit !== "CASE",
      needsQty: l.qty === null,
      outOfStock: skuId !== null && (stock.get(skuId) ?? 0) <= 0,
    };
  });
}
