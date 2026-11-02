/**
 * Order-level totals and the credit-hold decision. Pure and deterministic.
 */
import { z } from "zod";
import type { LinePricing } from "./scheme-engine";
import type { Paise } from "./money";

export interface OrderTotals {
  lineCount: number;
  totalCases: number;
  totalFreeCases: number;
  grossPaise: Paise;
  discountPaise: Paise;
  /** Taxable value, excl. GST. */
  subtotalPaise: Paise;
  gstPaise: Paise;
  grandTotalPaise: Paise;
  /** Lines skipped because they are not orderable (zero qty / stock). */
  excludedLines: Array<Pick<LinePricing, "skuCode" | "reason">>;
}

/**
 * Sum orderable lines. GST is summed from line-level (already rounded) GST so the
 * order total always equals the sum of its lines' totals.
 */
export function computeOrderTotals(lines: readonly LinePricing[]): OrderTotals {
  const totals: OrderTotals = {
    lineCount: 0,
    totalCases: 0,
    totalFreeCases: 0,
    grossPaise: 0,
    discountPaise: 0,
    subtotalPaise: 0,
    gstPaise: 0,
    grandTotalPaise: 0,
    excludedLines: [],
  };
  for (const line of lines) {
    if (!line.orderable) {
      totals.excludedLines.push({ skuCode: line.skuCode, reason: line.reason });
      continue;
    }
    totals.lineCount += 1;
    totals.totalCases += line.qtyCases;
    totals.totalFreeCases += line.freeCases;
    totals.grossPaise += line.grossPaise;
    totals.discountPaise += line.discountPaise;
    totals.subtotalPaise += line.subtotalPaise;
    totals.gstPaise += line.gstPaise;
    totals.grandTotalPaise += line.totalPaise;
  }
  return totals;
}

export const retailerCreditSchema = z.object({
  creditLimitPaise: z.number().int().nonnegative(),
  creditUsedPaise: z.number().int().nonnegative(),
});
export type RetailerCredit = z.infer<typeof retailerCreditSchema>;

export type CreditDecision =
  | { decision: "OK"; availablePaise: Paise; shortfallPaise: 0 }
  | { decision: "ON_HOLD"; availablePaise: Paise; shortfallPaise: Paise; reason: string };

export function availableCreditPaise(retailer: RetailerCredit): Paise {
  const r = retailerCreditSchema.parse(retailer);
  return Math.max(0, r.creditLimitPaise - r.creditUsedPaise);
}

/**
 * A9: if the order total exceeds available credit, the order goes ON_HOLD for the
 * desk — never silently rejected or accepted. Exactly at the limit is OK.
 */
export function decideCredit(retailer: RetailerCredit, grandTotalPaise: Paise): CreditDecision {
  const total = z.number().int().nonnegative().parse(grandTotalPaise);
  const availablePaise = availableCreditPaise(retailer);
  if (total <= availablePaise) {
    return { decision: "OK", availablePaise, shortfallPaise: 0 };
  }
  const shortfallPaise = total - availablePaise;
  return {
    decision: "ON_HOLD",
    availablePaise,
    shortfallPaise,
    reason: "Order total exceeds available credit",
  };
}

/** Status a freshly placed order should take, given its credit decision. */
export function initialOrderStatus(decision: CreditDecision): "PENDING_DESK_REVIEW" | "ON_HOLD" {
  return decision.decision === "OK" ? "PENDING_DESK_REVIEW" : "ON_HOLD";
}
