/**
 * Scheme engine — pure, deterministic line pricing.
 *
 * Business rules (see ASSUMPTIONS.md):
 *  A1 dealer price is per case.
 *  A2 prices exclude GST; GST is added per line using the SKU's rate.
 *  A3 at most one active scheme per SKU, never stacked.
 *  A4 free goods consume stock: shipped = ordered + free.
 *  A5 a slab discount applies to the entire line once the threshold is met.
 *
 * Rounding: discount and GST are each rounded half-up to whole paise at line level.
 */
import { z } from "zod";
import { applyBasisPoints, percentToBasisPoints, type Paise } from "./money";

export const SCHEME_TYPES = ["BUY_X_GET_Y_FREE", "SLAB_PERCENT_OFF"] as const;
export type SchemeType = (typeof SCHEME_TYPES)[number];

export const skuPricingSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  caseSize: z.number().int().positive(),
  dealerPricePerCasePaise: z.number().int().nonnegative(),
  gstRatePercent: z.number().int().min(0).max(28),
  stockCases: z.number().int().nonnegative(),
});
export type SkuForPricing = z.infer<typeof skuPricingSchema>;

export const schemeSchema = z
  .object({
    skuId: z.string().min(1),
    type: z.enum(SCHEME_TYPES),
    thresholdCases: z.number().int().positive(),
    freeCases: z.number().int().nonnegative(),
    percentOff: z.number().min(0).max(100),
    active: z.boolean(),
  })
  .superRefine((s, ctx) => {
    if (s.type === "BUY_X_GET_Y_FREE" && s.freeCases < 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "free-goods scheme needs freeCases >= 1" });
    }
    if (s.type === "SLAB_PERCENT_OFF" && s.percentOff <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "slab scheme needs percentOff > 0" });
    }
  });
export type SchemeForPricing = z.infer<typeof schemeSchema>;

export const qtyCasesSchema = z.number().int().nonnegative().max(100_000);

export type NotOrderableReason = "ZERO_QUANTITY" | "OUT_OF_STOCK" | "INSUFFICIENT_STOCK";

export interface LinePricing {
  skuId: string;
  skuCode: string;
  orderable: boolean;
  reasonCode: NotOrderableReason | null;
  /** Human-readable reason when not orderable. */
  reason: string | null;
  qtyCases: number;
  freeCases: number;
  /** Cases that leave the warehouse (ordered + free). */
  shippedCases: number;
  discountPercent: number;
  unitPricePaise: Paise;
  /** qty x unit price, before discount. */
  grossPaise: Paise;
  discountPaise: Paise;
  /** Taxable value: gross - discount. Excludes GST. */
  subtotalPaise: Paise;
  gstRatePercent: number;
  gstPaise: Paise;
  totalPaise: Paise;
  /** Label of the scheme actually applied to this line, else null. */
  schemeLabel: string | null;
  /** Nudge when a scheme exists but is not (fully) earned, e.g. "Add 1 more case to get 1 free". */
  schemeHint: string | null;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Display label for a scheme, e.g. "Buy 10 cases get 1 free", "3% off on 5 or more cases". */
export function describeScheme(scheme: SchemeForPricing): string {
  if (scheme.type === "BUY_X_GET_Y_FREE") {
    return `Buy ${plural(scheme.thresholdCases, "case")} get ${scheme.freeCases} free`;
  }
  return `${scheme.percentOff}% off on ${scheme.thresholdCases} or more cases`;
}

function applicableScheme(sku: SkuForPricing, scheme: SchemeForPricing | null | undefined) {
  if (!scheme || !scheme.active) return null;
  if (scheme.skuId !== sku.id) {
    throw new Error(`Scheme for ${scheme.skuId} passed for SKU ${sku.id}`);
  }
  return scheme;
}

/**
 * Price one order line. Never throws for business conditions (zero qty, stock):
 * those return orderable=false with a reason. Throws only on invalid input.
 */
export function priceLine(
  skuInput: SkuForPricing,
  qtyCasesInput: number,
  schemeInput?: SchemeForPricing | null,
): LinePricing {
  const sku = skuPricingSchema.parse(skuInput);
  const qtyCases = qtyCasesSchema.parse(qtyCasesInput);
  const scheme = applicableScheme(sku, schemeInput ? schemeSchema.parse(schemeInput) : null);

  const unitPricePaise = sku.dealerPricePerCasePaise;
  let freeCases = 0;
  let discountPercent = 0;
  let schemeLabel: string | null = null;
  let schemeHint: string | null = null;

  if (scheme && qtyCases > 0) {
    const label = describeScheme(scheme);
    if (scheme.type === "BUY_X_GET_Y_FREE") {
      // Repeats per multiple of the threshold: buy 10 get 1 -> 20 cases earn 2 free.
      const blocks = Math.floor(qtyCases / scheme.thresholdCases);
      freeCases = blocks * scheme.freeCases;
      if (freeCases > 0) schemeLabel = label;
      const toNext = scheme.thresholdCases - (qtyCases % scheme.thresholdCases);
      if (toNext < scheme.thresholdCases) {
        schemeHint = `Add ${plural(toNext, "more case")} to get ${scheme.freeCases} free`;
      }
    } else {
      if (qtyCases >= scheme.thresholdCases) {
        discountPercent = scheme.percentOff;
        schemeLabel = label;
      } else {
        schemeHint = `Add ${plural(scheme.thresholdCases - qtyCases, "more case")} to get ${scheme.percentOff}% off`;
      }
    }
  } else if (scheme) {
    schemeHint = describeScheme(scheme);
  }

  const shippedCases = qtyCases + freeCases;
  const grossPaise = qtyCases * unitPricePaise;
  const discountPaise = applyBasisPoints(grossPaise, percentToBasisPoints(discountPercent));
  const subtotalPaise = grossPaise - discountPaise;
  const gstPaise = applyBasisPoints(subtotalPaise, sku.gstRatePercent * 100);
  const totalPaise = subtotalPaise + gstPaise;

  let reasonCode: NotOrderableReason | null = null;
  let reason: string | null = null;
  if (sku.stockCases === 0) {
    reasonCode = "OUT_OF_STOCK";
    reason = `${sku.code} is out of stock`;
  } else if (qtyCases === 0) {
    reasonCode = "ZERO_QUANTITY";
    reason = "Quantity must be at least 1 case";
  } else if (shippedCases > sku.stockCases) {
    reasonCode = "INSUFFICIENT_STOCK";
    reason =
      freeCases > 0
        ? `Only ${plural(sku.stockCases, "case")} in stock; this line needs ${shippedCases} (${qtyCases} ordered + ${freeCases} free)`
        : `Only ${plural(sku.stockCases, "case")} in stock; ${qtyCases} requested`;
  }

  return {
    skuId: sku.id,
    skuCode: sku.code,
    orderable: reasonCode === null,
    reasonCode,
    reason,
    qtyCases,
    freeCases,
    shippedCases,
    discountPercent,
    unitPricePaise,
    grossPaise,
    discountPaise,
    subtotalPaise,
    gstRatePercent: sku.gstRatePercent,
    gstPaise,
    totalPaise,
    schemeLabel,
    schemeHint,
  };
}
