/**
 * Order desk actions. Each runs in one transaction, re-reads the order, refuses a
 * transition the status does not allow (lib/desk/transitions.ts), claims the order
 * with a conditional update so two desk users cannot both act on it, and writes an
 * audit row (status event or line correction).
 *
 * Credit and stock bookkeeping follow A10/A11: PENDING_DESK_REVIEW, CONFIRMED and
 * EXPORTED orders hold reserved credit, ON_HOLD orders do not; every placed order
 * holds its shipped stock until it is rejected.
 */
import { randomUUID } from "node:crypto";
import type { OrderStatus, Prisma, PrismaClient } from "@prisma/client";
import { learnAlias } from "@/lib/capture/service";
import { formatINR } from "@/lib/money";
import { loadSkus, quoteLine } from "@/lib/orders/quote";
import { availableCreditPaise, decideCredit } from "@/lib/pricing";
import { aliasPhraseFor } from "@/lib/sku-matcher";
import { istDateISO, istDayRange } from "./ist";
import { tallyCsvForOrders, type TallyOrderInput } from "./tally";
import { ALLOWED_FROM, canPerform, holdsReservedCredit, type DeskAction } from "./transitions";
import { systemNote } from "@/lib/orders/system-notes";

export interface DeskActor {
  name: string;
}

export type DeskErrorCode =
  | "NOT_FOUND"
  | "INVALID_TRANSITION"
  | "CREDIT_CONFIRM_REQUIRED"
  | "LINE_NOT_FOUND"
  | "UNKNOWN_SKU"
  | "SKU_ALREADY_IN_ORDER"
  | "INSUFFICIENT_STOCK"
  | "NO_CHANGE"
  | "NOTHING_TO_EXPORT";

export type DeskFailure = {
  ok: false;
  code: DeskErrorCode;
  message: string;
  /** Present on CREDIT_CONFIRM_REQUIRED: the current shortfall the desk must confirm. */
  shortfallPaise?: number;
  status?: OrderStatus;
};

export type DeskResult<T = object> = ({ ok: true } & T) | DeskFailure;

export const DESK_ERROR_HTTP: Record<DeskErrorCode, number> = {
  NOT_FOUND: 404,
  INVALID_TRANSITION: 409,
  CREDIT_CONFIRM_REQUIRED: 409,
  LINE_NOT_FOUND: 404,
  UNKNOWN_SKU: 422,
  SKU_ALREADY_IN_ORDER: 409,
  INSUFFICIENT_STOCK: 409,
  NO_CHANGE: 400,
  NOTHING_TO_EXPORT: 409,
};

class Abort extends Error {
  constructor(public failure: DeskFailure) {
    super(failure.code);
  }
}

const STATUS_WORD: Record<OrderStatus, string> = {
  DRAFT: "draft",
  PENDING_DESK_REVIEW: "pending review",
  ON_HOLD: "on hold",
  CONFIRMED: "approved",
  EXPORTED: "exported",
  REJECTED: "rejected",
};

function invalidTransition(action: DeskAction, status: OrderStatus): DeskFailure {
  const allowed = ALLOWED_FROM[action].map((s) => STATUS_WORD[s]).join(" or ");
  return {
    ok: false,
    code: "INVALID_TRANSITION",
    status,
    message: `Cannot ${action.toLowerCase().replace("_", " ")} an order that is ${STATUS_WORD[status]} (allowed only when ${allowed}).`,
  };
}

async function run<T>(db: PrismaClient, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T | DeskFailure> {
  try {
    return await db.$transaction(fn);
  } catch (err) {
    if (err instanceof Abort) return err.failure;
    throw err;
  }
}

async function loadOrder(tx: Prisma.TransactionClient, orderId: string, action: DeskAction) {
  const order = await tx.order.findUnique({ where: { id: orderId }, include: { retailer: true, lines: true } });
  if (!order) throw new Abort({ ok: false, code: "NOT_FOUND", message: "Order not found." });
  if (!canPerform(action, order.status)) throw new Abort(invalidTransition(action, order.status));
  return order;
}

/** Move status only if nobody changed it since we read it (optimistic claim). */
async function claim(tx: Prisma.TransactionClient, orderId: string, from: OrderStatus, data: Prisma.OrderUpdateManyMutationInput) {
  const res = await tx.order.updateMany({ where: { id: orderId, status: from }, data });
  if (res.count !== 1) {
    throw new Abort({ ok: false, code: "INVALID_TRANSITION", message: "The order was changed by someone else. Reload and try again." });
  }
}

/** Current shortfall if this order's total were added to the retailer's used credit now. */
export function currentShortfallPaise(
  retailer: { creditLimitPaise: number; creditUsedPaise: number },
  grandTotalPaise: number,
  status: OrderStatus,
): number {
  // An order that already holds reserved credit is part of creditUsed; don't count it twice.
  const used = holdsReservedCredit(status) ? retailer.creditUsedPaise - grandTotalPaise : retailer.creditUsedPaise;
  return Math.max(0, grandTotalPaise - Math.max(0, retailer.creditLimitPaise - Math.max(0, used)));
}

// ---------------------------------------------------------------- approve

export interface ApproveInput {
  /**
   * Required when the order is over the retailer's available credit: the shortfall the
   * desk saw in the confirm dialog. If credit moved since, the server refuses and
   * returns the new shortfall so the dialog can be shown again (A22).
   */
  confirmShortfallPaise?: number;
}

export async function approveOrder(
  db: PrismaClient,
  orderId: string,
  actor: DeskActor,
  input: ApproveInput = {},
): Promise<DeskResult<{ status: "CONFIRMED"; overLimitByPaise: number }>> {
  return run(db, async (tx) => {
    const order = await loadOrder(tx, orderId, "APPROVE");
    let overLimitByPaise = 0;
    if (order.status === "ON_HOLD") {
      overLimitByPaise = currentShortfallPaise(order.retailer, order.grandTotalPaise, order.status);
      if (overLimitByPaise > 0 && input.confirmShortfallPaise !== overLimitByPaise) {
        throw new Abort({
          ok: false,
          code: "CREDIT_CONFIRM_REQUIRED",
          shortfallPaise: overLimitByPaise,
          message: `Approving will take the retailer over their credit limit by ${formatINR(overLimitByPaise)}. Confirm to continue.`,
        });
      }
    }
    const now = new Date();
    await claim(tx, order.id, order.status, { status: "CONFIRMED", approvedAt: now });
    if (order.status === "ON_HOLD") {
      // A10: an ON_HOLD order reserved no credit; approving reserves it now, even over the limit.
      await tx.retailer.update({ where: { id: order.retailerId }, data: { creditUsedPaise: { increment: order.grandTotalPaise } } });
    }
    await tx.orderStatusEvent.create({
      data: {
        orderId: order.id,
        fromStatus: order.status,
        toStatus: "CONFIRMED",
        actorRole: "ORDER_DESK",
        actorName: actor.name,
        note: overLimitByPaise > 0 ? systemNote.approvedOverLimit(formatINR(overLimitByPaise)) : systemNote.approved(),
        createdAt: now,
      },
    });
    return { ok: true as const, status: "CONFIRMED" as const, overLimitByPaise };
  });
}

// ---------------------------------------------------------------- hold

export async function holdOrder(
  db: PrismaClient,
  orderId: string,
  actor: DeskActor,
  reason: string,
): Promise<DeskResult<{ status: "ON_HOLD" }>> {
  return run(db, async (tx) => {
    const order = await loadOrder(tx, orderId, "HOLD");
    // Release the reserved credit first so the shortfall reflects the retailer without this order.
    await tx.retailer.update({ where: { id: order.retailerId }, data: { creditUsedPaise: { decrement: order.grandTotalPaise } } });
    const shortfall = currentShortfallPaise(order.retailer, order.grandTotalPaise, order.status);
    await claim(tx, order.id, order.status, { status: "ON_HOLD", holdReason: reason, creditShortfallPaise: shortfall > 0 ? shortfall : null });
    await tx.orderStatusEvent.create({
      data: { orderId: order.id, fromStatus: order.status, toStatus: "ON_HOLD", actorRole: "ORDER_DESK", actorName: actor.name, note: reason },
    });
    return { ok: true as const, status: "ON_HOLD" as const };
  });
}

// ---------------------------------------------------------------- reject

export async function rejectOrder(
  db: PrismaClient,
  orderId: string,
  actor: DeskActor,
  reason: string,
): Promise<DeskResult<{ status: "REJECTED" }>> {
  return run(db, async (tx) => {
    const order = await loadOrder(tx, orderId, "REJECT");
    await claim(tx, order.id, order.status, { status: "REJECTED", rejectionReason: reason });
    // A11: a rejected order gives its shipped cases (incl. free goods) back to stock.
    for (const l of order.lines) {
      await tx.sKU.update({ where: { id: l.skuId }, data: { stockCases: { increment: l.qtyCases + l.freeCases } } });
    }
    if (holdsReservedCredit(order.status)) {
      await tx.retailer.update({ where: { id: order.retailerId }, data: { creditUsedPaise: { decrement: order.grandTotalPaise } } });
    }
    await tx.orderStatusEvent.create({
      data: { orderId: order.id, fromStatus: order.status, toStatus: "REJECTED", actorRole: "ORDER_DESK", actorName: actor.name, note: reason },
    });
    return { ok: true as const, status: "REJECTED" as const };
  });
}

// ---------------------------------------------------------------- correct a line

export interface CorrectLineInput {
  lineId: string;
  /** New SKU (swap). Omit to keep the SKU. */
  skuId?: string;
  /** New quantity in cases. Omit to keep the quantity. */
  qtyCases?: number;
  reason?: string;
}

export async function correctOrderLine(
  db: PrismaClient,
  orderId: string,
  actor: DeskActor,
  input: CorrectLineInput,
): Promise<DeskResult<{ status: OrderStatus; grandTotalPaise: number; aliasPhrase: string | null }>> {
  return run(db, async (tx) => {
    const order = await loadOrder(tx, orderId, "CORRECT_LINE");
    const line = order.lines.find((l) => l.id === input.lineId);
    if (!line) throw new Abort({ ok: false, code: "LINE_NOT_FOUND", message: "That line is not part of this order." });

    const newSkuId = input.skuId ?? line.skuId;
    const newQty = input.qtyCases ?? line.qtyCases;
    if (newSkuId === line.skuId && newQty === line.qtyCases) {
      throw new Abort({ ok: false, code: "NO_CHANGE", message: "Nothing changed on this line." });
    }
    if (newSkuId !== line.skuId && order.lines.some((l) => l.skuId === newSkuId)) {
      throw new Abort({
        ok: false,
        code: "SKU_ALREADY_IN_ORDER",
        message: "That SKU is already another line of this order. Change that line's quantity instead.",
      });
    }

    // Claim first (status unchanged) so a concurrent desk action on this order fails cleanly.
    await claim(tx, order.id, order.status, { updatedAt: new Date() });

    // Give back the old line's shipped cases, then price and reserve the new line
    // against current stock and scheme (A4, A11).
    await tx.sKU.update({ where: { id: line.skuId }, data: { stockCases: { increment: line.qtyCases + line.freeCases } } });
    const sku = (await loadSkus(tx, [newSkuId])).get(newSkuId);
    if (!sku) throw new Abort({ ok: false, code: "UNKNOWN_SKU", message: "That SKU is not in the active catalogue." });
    const priced = quoteLine(sku, newQty);
    if (!priced.orderable) {
      throw new Abort({
        ok: false,
        code: "INSUFFICIENT_STOCK",
        message: `${priced.reason ?? "Not enough stock"}. At most ${priced.maxOrderableCases} cases can ship.`,
      });
    }
    const taken = await tx.sKU.updateMany({
      where: { id: sku.id, stockCases: { gte: priced.shippedCases } },
      data: { stockCases: { decrement: priced.shippedCases } },
    });
    if (taken.count !== 1) throw new Abort({ ok: false, code: "INSUFFICIENT_STOCK", message: "Stock changed. Reload and try again." });

    await tx.orderLine.update({
      where: { id: line.id },
      data: {
        skuId: sku.id,
        skuCode: sku.code,
        skuName: sku.name,
        caseSize: sku.caseSize,
        gstRatePercent: sku.gstRatePercent,
        qtyCases: priced.qtyCases,
        unitPricePaise: priced.unitPricePaise,
        freeCases: priced.freeCases,
        discountPercent: priced.discountPercent,
        discountPaise: priced.discountPaise,
        subtotalPaise: priced.subtotalPaise,
        gstPaise: priced.gstPaise,
        totalPaise: priced.totalPaise,
        schemeLabel: priced.schemeLabel,
      },
    });

    // Order totals are the sum of the (snapshotted) lines.
    const lines = await tx.orderLine.findMany({ where: { orderId: order.id } });
    const totals = lines.reduce(
      (t, l) => ({
        subtotalPaise: t.subtotalPaise + l.subtotalPaise,
        discountPaise: t.discountPaise + l.discountPaise,
        gstPaise: t.gstPaise + l.gstPaise,
        grandTotalPaise: t.grandTotalPaise + l.totalPaise,
      }),
      { subtotalPaise: 0, discountPaise: 0, gstPaise: 0, grandTotalPaise: 0 },
    );

    // Credit re-check (A9/A10, A25): a pending order that now exceeds credit goes on hold;
    // an on-hold order stays on hold with a refreshed shortfall.
    let status = order.status;
    let holdReason = order.holdReason;
    let creditShortfallPaise = order.creditShortfallPaise;
    const retailer = await tx.retailer.findUniqueOrThrow({ where: { id: order.retailerId } });
    if (order.status === "PENDING_DESK_REVIEW") {
      const usedWithout = retailer.creditUsedPaise - order.grandTotalPaise;
      const credit = decideCredit({ creditLimitPaise: retailer.creditLimitPaise, creditUsedPaise: Math.max(0, usedWithout) }, totals.grandTotalPaise);
      if (credit.decision === "OK") {
        await tx.retailer.update({ where: { id: retailer.id }, data: { creditUsedPaise: { increment: totals.grandTotalPaise - order.grandTotalPaise } } });
      } else {
        await tx.retailer.update({ where: { id: retailer.id }, data: { creditUsedPaise: { decrement: order.grandTotalPaise } } });
        status = "ON_HOLD";
        creditShortfallPaise = credit.shortfallPaise;
        holdReason = systemNote.correctionHold(formatINR(credit.shortfallPaise));
      }
    } else {
      const shortfall = Math.max(0, totals.grandTotalPaise - availableCreditPaise(retailer));
      creditShortfallPaise = shortfall > 0 ? shortfall : null;
    }

    await tx.order.update({ where: { id: order.id }, data: { ...totals, status, holdReason, creditShortfallPaise } });
    if (status !== order.status) {
      await tx.orderStatusEvent.create({
        data: { orderId: order.id, fromStatus: order.status, toStatus: status, actorRole: "ORDER_DESK", actorName: actor.name, note: holdReason },
      });
    }

    // A26: every desk correction of an AI-captured line teaches the retailer's alias.
    let aliasPhrase: string | null = null;
    if (order.source === "AI_TEXT" && line.sourceProductText) {
      aliasPhrase = aliasPhraseFor(line.sourceProductText);
      if (aliasPhrase) await learnAlias(tx, order.retailerId, line.sourceProductText, sku.id, sku.id !== line.skuId);
    }

    await tx.orderLineCorrection.create({
      data: {
        orderId: order.id,
        orderLineId: line.id,
        actorName: actor.name,
        fromSkuCode: line.skuCode,
        toSkuCode: sku.code,
        fromQtyCases: line.qtyCases,
        toQtyCases: priced.qtyCases,
        aliasPhrase,
        reason: input.reason ?? null,
      },
    });

    return { ok: true as const, status, grandTotalPaise: totals.grandTotalPaise, aliasPhrase };
  });
}

// ---------------------------------------------------------------- Tally export (mocked, A8)

const EXPORT_INCLUDE = { retailer: { select: { shopName: true, area: true } }, lines: { orderBy: { skuName: "asc" as const } } };

export interface ExportResult {
  csv: string;
  fileName: string;
  orderNumbers: string[];
  batchId: string | null;
}

async function exportWithin(
  tx: Prisma.TransactionClient,
  orders: Array<TallyOrderInput & { id: string; status: OrderStatus }>,
  actor: DeskActor,
  batchId: string | null,
  now: Date,
): Promise<string> {
  for (const order of orders) {
    if (!canPerform("EXPORT", order.status)) throw new Abort(invalidTransition("EXPORT", order.status));
    await claim(tx, order.id, order.status, { status: "EXPORTED", exportedAt: now });
    await tx.tallyExport.create({
      data: { orderId: order.id, exportedAt: now, exportedBy: actor.name, batchId, csvPayload: tallyCsvForOrders([order]) },
    });
    await tx.orderStatusEvent.create({
      data: {
        orderId: order.id,
        fromStatus: order.status,
        toStatus: "EXPORTED",
        actorRole: "ORDER_DESK",
        actorName: actor.name,
        note: systemNote.exported(!!batchId),
        createdAt: now,
      },
    });
  }
  return tallyCsvForOrders(orders);
}

export async function exportOrderToTally(db: PrismaClient, orderId: string, actor: DeskActor): Promise<DeskResult<ExportResult>> {
  return run(db, async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: EXPORT_INCLUDE });
    if (!order) throw new Abort({ ok: false, code: "NOT_FOUND", message: "Order not found." });
    const now = new Date();
    const csv = await exportWithin(tx, [order], actor, null, now);
    return { ok: true as const, csv, fileName: `tally-${order.orderNumber}.csv`, orderNumbers: [order.orderNumber], batchId: null };
  });
}

/** A27: "today's approved" = orders still CONFIRMED whose approval happened today (IST). */
export async function exportTodaysApproved(db: PrismaClient, actor: DeskActor, now: Date = new Date()): Promise<DeskResult<ExportResult>> {
  const { start, end } = istDayRange(now);
  return run(db, async (tx) => {
    const orders = await tx.order.findMany({
      where: { status: "CONFIRMED", approvedAt: { gte: start, lt: end } },
      include: EXPORT_INCLUDE,
      orderBy: { orderNumber: "asc" },
    });
    if (orders.length === 0) {
      throw new Abort({ ok: false, code: "NOTHING_TO_EXPORT", message: "No orders approved today are waiting for export." });
    }
    const batchId = randomUUID();
    const csv = await exportWithin(tx, orders, actor, batchId, now);
    return {
      ok: true as const,
      csv,
      fileName: `tally-approved-${istDateISO(now)}.csv`,
      orderNumbers: orders.map((o) => o.orderNumber),
      batchId,
    };
  });
}
