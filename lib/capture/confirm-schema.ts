import { z } from "zod";
import { MAX_CASES_PER_LINE, SHORTAGE_POLICIES } from "@/lib/orders/cart-schema";
import { MAX_MESSAGE_CHARS } from "@/lib/ai-capture";

export const captureRequestSchema = z.object({
  text: z.string().trim().min(2, "Type or paste an order").max(MAX_MESSAGE_CHARS),
  /** "offline" lets the retailer explicitly use the offline parser (e.g. after an AI failure). */
  engine: z.enum(["auto", "offline"]).default("auto"),
});

/**
 * How the retailer resolved an unclear unit. CASE = "I meant cases";
 * PIECES = "I meant pieces", converted to whole cases they then confirmed.
 */
export const UNIT_CHOICES = ["CASE", "PIECES"] as const;

export const confirmLineSchema = z.object({
  lineId: z.string().min(1).max(10),
  skuId: z.string().min(1).max(64),
  qtyCases: z.number().int().min(1).max(MAX_CASES_PER_LINE),
  unitChoice: z.enum(UNIT_CHOICES).optional(),
});

export const confirmCaptureSchema = z.object({
  clientRequestId: z.string().uuid(),
  shortagePolicy: z.enum(SHORTAGE_POLICIES).default("REJECT"),
  lines: z.array(confirmLineSchema).min(1, "Nothing to order").max(50),
  removedLineIds: z.array(z.string().min(1).max(10)).max(50).default([]),
});
export type ConfirmCaptureInput = z.output<typeof confirmCaptureSchema>;
