import { z } from "zod";
import { MAX_CASES_PER_LINE } from "@/lib/orders/cart-schema";

const reason = z.string().trim().min(3, "Give a reason (at least 3 characters)").max(500);

export const approveBodySchema = z.object({
  confirmShortfallPaise: z.number().int().nonnegative().optional(),
});

export const holdBodySchema = z.object({ reason });
export const rejectBodySchema = z.object({ reason });

export const correctLineBodySchema = z
  .object({
    skuId: z.string().min(1).max(64).optional(),
    qtyCases: z.number().int().min(1).max(MAX_CASES_PER_LINE).optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((b) => b.skuId !== undefined || b.qtyCases !== undefined, { message: "Change the SKU or the quantity" });
