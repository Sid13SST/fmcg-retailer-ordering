/**
 * Server-side cart pricing. Reads current SKUs, stock and active schemes, prices
 * every line with the scheme engine and previews the credit impact. Works with
 * the root Prisma client or a transaction client.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { computeOrderTotals, decideCredit, type OrderTotals } from "@/lib/pricing";
import { maxOrderableCases, priceLine, type LinePricing, type SchemeForPricing } from "@/lib/scheme-engine";
import type { QuoteInput } from "./cart-schema";

export type Db = PrismaClient | Prisma.TransactionClient;

export interface CatalogSku {
  id: string;
  code: string;
  name: string;
  brand: string;
  category: string;
  caseSize: number;
  dealerPricePerCasePaise: number;
  gstRatePercent: number;
  stockCases: number;
  imageEmoji: string | null;
  scheme: SchemeForPricing | null;
}

export interface QuotedLine extends LinePricing {
  name: string;
  brand: string;
  caseSize: number;
  imageEmoji: string | null;
  stockCases: number;
  /** Most this line could be cut to and still ship (A4). */
  maxOrderableCases: number;
  /** Active scheme on the SKU, so the UI can show localized nudges. */
  scheme: SchemeForPricing | null;
}

export interface CreditPreview {
  limitPaise: number;
  usedPaise: number;
  availablePaise: number;
  orderTotalPaise: number;
  /** Available credit left after this order, never below 0. */
  remainingAfterPaise: number;
  decision: "OK" | "ON_HOLD";
  shortfallPaise: number;
}

export interface QuoteSummary {
  lines: QuotedLine[];
  totals: OrderTotals;
  credit: CreditPreview;
}

export interface Quote extends QuoteSummary {
  /**
   * When some lines exceed stock: what the order would be if the retailer accepts
   * the confirmable quantities (A12). Null when every line is orderable.
   */
  shortConfirm: QuoteSummary | null;
  /** SKUs in the request that no longer exist or are inactive. */
  unknownSkuIds: string[];
}

export async function loadSkus(db: Db, ids: readonly string[]): Promise<Map<string, CatalogSku>> {
  const rows = await db.sKU.findMany({
    where: { id: { in: [...ids] }, active: true },
    include: { schemes: { where: { active: true }, orderBy: { createdAt: "desc" }, take: 1 } },
  });
  return new Map(
    rows.map((r) => {
      const s = r.schemes[0];
      const scheme: SchemeForPricing | null = s
        ? { skuId: s.skuId, type: s.type, thresholdCases: s.thresholdCases, freeCases: s.freeCases, percentOff: s.percentOff, active: s.active }
        : null;
      return [
        r.id,
        {
          id: r.id,
          code: r.code,
          name: r.name,
          brand: r.brand,
          category: r.category,
          caseSize: r.caseSize,
          dealerPricePerCasePaise: r.dealerPricePerCasePaise,
          gstRatePercent: r.gstRatePercent,
          stockCases: r.stockCases,
          imageEmoji: r.imageEmoji,
          scheme,
        },
      ];
    }),
  );
}

export function quoteLine(sku: CatalogSku, qtyCases: number): QuotedLine {
  return {
    ...priceLine(sku, qtyCases, sku.scheme),
    name: sku.name,
    brand: sku.brand,
    caseSize: sku.caseSize,
    imageEmoji: sku.imageEmoji,
    stockCases: sku.stockCases,
    maxOrderableCases: maxOrderableCases(sku, qtyCases, sku.scheme),
    scheme: sku.scheme,
  };
}

export function previewCredit(
  retailer: { creditLimitPaise: number; creditUsedPaise: number },
  orderTotalPaise: number,
): CreditPreview {
  const d = decideCredit(retailer, orderTotalPaise);
  return {
    limitPaise: retailer.creditLimitPaise,
    usedPaise: retailer.creditUsedPaise,
    availablePaise: d.availablePaise,
    orderTotalPaise,
    remainingAfterPaise: Math.max(0, d.availablePaise - orderTotalPaise),
    decision: d.decision,
    shortfallPaise: d.shortfallPaise,
  };
}

export async function quoteCart(db: Db, retailerId: string, input: QuoteInput): Promise<Quote | null> {
  const retailer = await db.retailer.findUnique({ where: { id: retailerId } });
  if (!retailer) return null;
  const skus = await loadSkus(db, input.lines.map((l) => l.skuId));
  const lines: QuotedLine[] = [];
  const unknownSkuIds: string[] = [];
  for (const l of input.lines) {
    const sku = skus.get(l.skuId);
    if (sku) lines.push(quoteLine(sku, l.qtyCases));
    else unknownSkuIds.push(l.skuId);
  }
  const totals = computeOrderTotals(lines);

  let shortConfirm: QuoteSummary | null = null;
  if (lines.some((l) => !l.orderable)) {
    const adjusted = lines.flatMap((l) => {
      if (l.orderable) return [l];
      const sku = skus.get(l.skuId);
      return sku && l.maxOrderableCases > 0 ? [quoteLine(sku, l.maxOrderableCases)] : [];
    });
    const adjustedTotals = computeOrderTotals(adjusted);
    shortConfirm = {
      lines: adjusted,
      totals: adjustedTotals,
      credit: previewCredit(retailer, adjustedTotals.grandTotalPaise),
    };
  }

  return { lines, totals, credit: previewCredit(retailer, totals.grandTotalPaise), shortConfirm, unknownSkuIds };
}
