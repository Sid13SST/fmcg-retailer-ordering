import { z } from "zod";

export const MAX_CASES_PER_LINE = 9999;
export const MAX_CART_LINES = 100;

export const cartLineInputSchema = z.object({
  skuId: z.string().min(1).max(64),
  qtyCases: z.number().int().min(1).max(MAX_CASES_PER_LINE),
});

/** Duplicate SKUs are merged so the same item cannot be priced twice. */
const linesSchema = z
  .array(cartLineInputSchema)
  .min(1, "Cart is empty")
  .max(MAX_CART_LINES)
  .transform((lines) => {
    const merged = new Map<string, number>();
    for (const l of lines) merged.set(l.skuId, (merged.get(l.skuId) ?? 0) + l.qtyCases);
    return [...merged].map(([skuId, qtyCases]) => ({ skuId, qtyCases: Math.min(qtyCases, MAX_CASES_PER_LINE) }));
  });

export const quoteInputSchema = z.object({ lines: linesSchema });
export type QuoteInput = z.output<typeof quoteInputSchema>;

/**
 * REJECT: if any line exceeds stock, nothing is written and the conflicts are returned.
 * SHORT_CONFIRM: the retailer explicitly accepted reduced quantities; lines are cut to
 * what stock allows and out-of-stock lines are dropped.
 */
export const SHORTAGE_POLICIES = ["REJECT", "SHORT_CONFIRM"] as const;
export type ShortagePolicy = (typeof SHORTAGE_POLICIES)[number];

export const placeOrderInputSchema = z.object({
  lines: linesSchema,
  clientRequestId: z.string().uuid(),
  shortagePolicy: z.enum(SHORTAGE_POLICIES).default("REJECT"),
});
export type PlaceOrderInput = z.output<typeof placeOrderInputSchema>;
