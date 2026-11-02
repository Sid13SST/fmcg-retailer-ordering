/**
 * Server-side order creation for retailers.
 *
 * Inside one transaction: re-read stock and schemes, price every line with the
 * scheme engine, apply the shortage policy, decide credit (A9), decrement stock
 * by shipped cases incl. free goods (A4), reserve credit (A10), write the order,
 * its lines and the first status event. Any failure rolls everything back.
 */
import { Prisma, type OrderSource, type PrismaClient } from "@prisma/client";
import { formatINR } from "@/lib/money";
import { computeOrderTotals } from "@/lib/pricing";
import type { PlaceOrderInput } from "./cart-schema";
import { loadSkus, previewCredit, quoteLine, type CreditPreview, type QuotedLine } from "./quote";
import { NOTE_SEPARATOR, systemNote } from "./system-notes";

export interface StockIssue {
  skuId: string;
  skuCode: string;
  name: string;
  requestedCases: number;
  /** Quantity that can be confirmed now (0 = cannot be supplied). */
  availableCases: number;
  reason: string;
}

export type CreateOrderResult =
  | {
      ok: true;
      duplicate: boolean;
      orderId: string;
      orderNumber: string;
      status: "PENDING_DESK_REVIEW" | "ON_HOLD";
      grandTotalPaise: number;
      credit: CreditPreview | null;
      /** Lines cut or dropped under SHORT_CONFIRM. */
      adjustments: StockIssue[];
    }
  | { ok: false; code: "STOCK_CONFLICT"; message: string; issues: StockIssue[] }
  | { ok: false; code: "NOTHING_ORDERABLE"; message: string; issues: StockIssue[] }
  | { ok: false; code: "UNKNOWN_SKU"; message: string; skuIds: string[] }
  | { ok: false; code: "RETAILER_NOT_FOUND"; message: string }
  | { ok: false; code: "STOCK_CHANGED"; message: string };

class StockRaceError extends Error {}
class AbortWith extends Error {
  constructor(public result: CreateOrderResult) {
    super(result.ok ? "ok" : result.code);
  }
}

function issueFor(line: QuotedLine, requestedCases: number): StockIssue {
  return {
    skuId: line.skuId,
    skuCode: line.skuCode,
    name: line.name,
    requestedCases,
    availableCases: line.maxOrderableCases,
    reason: line.reason ?? "Not available",
  };
}

async function nextOrderNumber(tx: Prisma.TransactionClient): Promise<string> {
  const last = await tx.order.findFirst({ orderBy: { orderNumber: "desc" }, select: { orderNumber: true } });
  const n = last ? Number(last.orderNumber.replace(/\D/g, "")) + 1 : 1;
  return `KOD-${String(n).padStart(5, "0")}`;
}

async function existingByRequestId(db: PrismaClient, retailerId: string, clientRequestId: string) {
  const order = await db.order.findUnique({ where: { clientRequestId } });
  if (!order || order.retailerId !== retailerId) return null;
  const result: CreateOrderResult = {
    ok: true,
    duplicate: true,
    orderId: order.id,
    orderNumber: order.orderNumber,
    status: order.status === "ON_HOLD" ? "ON_HOLD" : "PENDING_DESK_REVIEW",
    grandTotalPaise: order.grandTotalPaise,
    credit: null,
    adjustments: [],
  };
  return result;
}

export interface CreateOrderOptions {
  /** CATALOG (default) or AI_TEXT for orders confirmed from a text capture. */
  source?: OrderSource;
  /** Extra context for the order note and first status event, e.g. "Captured from text (Gemini)". */
  note?: string;
  /**
   * Runs inside the same transaction after the order is written (e.g. mark the AI
   * capture confirmed, learn aliases). Throwing rolls the whole order back.
   */
  onCreated?: (tx: Prisma.TransactionClient, order: { id: string; orderNumber: string }) => Promise<void>;
}

export async function createRetailerOrder(
  db: PrismaClient,
  retailerId: string,
  input: PlaceOrderInput,
  options: CreateOrderOptions = {},
): Promise<CreateOrderResult> {
  const previous = await existingByRequestId(db, retailerId, input.clientRequestId);
  if (previous) return previous;

  try {
    return await db.$transaction(async (tx) => {
      const retailer = await tx.retailer.findUnique({ where: { id: retailerId } });
      if (!retailer) throw new AbortWith({ ok: false, code: "RETAILER_NOT_FOUND", message: "Retailer not found" });

      const skus = await loadSkus(tx, input.lines.map((l) => l.skuId));
      const unknown = input.lines.filter((l) => !skus.has(l.skuId)).map((l) => l.skuId);
      if (unknown.length > 0) {
        throw new AbortWith({
          ok: false,
          code: "UNKNOWN_SKU",
          message: "Some items are no longer in the catalogue. Remove them and try again.",
          skuIds: unknown,
        });
      }

      const finalLines: QuotedLine[] = [];
      const issues: StockIssue[] = [];
      for (const req of input.lines) {
        const sku = skus.get(req.skuId)!;
        const line = quoteLine(sku, req.qtyCases);
        if (line.orderable) {
          finalLines.push(line);
          continue;
        }
        issues.push(issueFor(line, req.qtyCases));
        if (input.shortagePolicy === "SHORT_CONFIRM" && line.maxOrderableCases > 0) {
          finalLines.push(quoteLine(sku, line.maxOrderableCases));
        }
      }

      if (issues.length > 0 && input.shortagePolicy === "REJECT") {
        throw new AbortWith({
          ok: false,
          code: "STOCK_CONFLICT",
          message: "Some items do not have enough stock. Review the quantities below.",
          issues,
        });
      }
      if (finalLines.length === 0) {
        throw new AbortWith({
          ok: false,
          code: "NOTHING_ORDERABLE",
          message: "None of the items in your cart can be supplied right now.",
          issues,
        });
      }

      const totals = computeOrderTotals(finalLines);
      const credit = previewCredit(retailer, totals.grandTotalPaise);
      const status = credit.decision === "OK" ? "PENDING_DESK_REVIEW" : "ON_HOLD";

      // Decrement stock by shipped cases (ordered + free). The conditional update
      // guarantees stock never goes negative even under concurrent orders.
      for (const line of finalLines) {
        const res = await tx.sKU.updateMany({
          where: { id: line.skuId, stockCases: { gte: line.shippedCases } },
          data: { stockCases: { decrement: line.shippedCases } },
        });
        if (res.count !== 1) throw new StockRaceError(line.skuCode);
      }

      // A10: credit is reserved only for orders that pass the credit check.
      if (status === "PENDING_DESK_REVIEW") {
        await tx.retailer.update({
          where: { id: retailer.id },
          data: { creditUsedPaise: { increment: totals.grandTotalPaise } },
        });
      }

      const holdReason =
        status === "ON_HOLD"
          ? systemNote.creditHold(formatINR(credit.shortfallPaise))
          : null;
      const shortNote =
        issues.length > 0
          ? systemNote.shortConfirmed(issues)
          : null;
      const notes = [options.note, shortNote].filter(Boolean).join(NOTE_SEPARATOR) || null;

      const order = await tx.order.create({
        data: {
          orderNumber: await nextOrderNumber(tx),
          clientRequestId: input.clientRequestId,
          retailerId: retailer.id,
          status,
          source: options.source ?? "CATALOG",
          createdByRole: "RETAILER",
          subtotalPaise: totals.subtotalPaise,
          discountPaise: totals.discountPaise,
          gstPaise: totals.gstPaise,
          grandTotalPaise: totals.grandTotalPaise,
          holdReason,
          creditShortfallPaise: status === "ON_HOLD" ? credit.shortfallPaise : null,
          notes,
          lines: {
            create: finalLines.map((l) => ({
              skuId: l.skuId,
              skuCode: l.skuCode,
              skuName: l.name,
              caseSize: l.caseSize,
              gstRatePercent: l.gstRatePercent,
              qtyCases: l.qtyCases,
              unitPricePaise: l.unitPricePaise,
              freeCases: l.freeCases,
              discountPercent: l.discountPercent,
              discountPaise: l.discountPaise,
              subtotalPaise: l.subtotalPaise,
              gstPaise: l.gstPaise,
              totalPaise: l.totalPaise,
              schemeLabel: l.schemeLabel,
            })),
          },
          statusEvents: {
            create: { fromStatus: null, toStatus: status, actorRole: "RETAILER", note: holdReason ?? notes },
          },
        },
      });

      if (options.onCreated) await options.onCreated(tx, { id: order.id, orderNumber: order.orderNumber });

      return {
        ok: true as const,
        duplicate: false,
        orderId: order.id,
        orderNumber: order.orderNumber,
        status,
        grandTotalPaise: order.grandTotalPaise,
        credit,
        adjustments: issues,
      };
    });
  } catch (err) {
    if (err instanceof AbortWith) return err.result;
    if (err instanceof StockRaceError) {
      return { ok: false, code: "STOCK_CHANGED", message: "Stock changed while placing your order. Please review your cart." };
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Same clientRequestId raced in: return the order that won.
      const winner = await existingByRequestId(db, retailerId, input.clientRequestId);
      if (winner) return winner;
    }
    throw err;
  }
}
