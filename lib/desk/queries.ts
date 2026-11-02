/**
 * Read models for the order desk screens. Desk-only: callers must have checked the
 * ORDER_DESK role.
 */
import type { OrderSource, OrderStatus } from "@prisma/client";
import type { Db } from "@/lib/orders/quote";
import { currentShortfallPaise } from "./actions";
import { daysBetween, istDayRange } from "./ist";

/** Statuses shown in the desk queue. DRAFT orders were never submitted and are not desk work. */
export const QUEUE_STATUSES = ["PENDING_DESK_REVIEW", "ON_HOLD", "CONFIRMED", "EXPORTED", "REJECTED"] as const satisfies readonly OrderStatus[];
export type QueueStatus = (typeof QUEUE_STATUSES)[number];

export function parseQueueStatus(value: string | undefined | null): QueueStatus | null {
  return (QUEUE_STATUSES as readonly string[]).includes(value ?? "") ? (value as QueueStatus) : null;
}

export interface QueueRow {
  id: string;
  orderNumber: string;
  createdAt: Date;
  status: OrderStatus;
  source: OrderSource;
  retailer: { id: string; shopName: string; area: string };
  lineCount: number;
  grandTotalPaise: number;
  /** Shortfall if the order were approved now (0 = within limit). Null once credit is settled (approved/exported/rejected). */
  creditShortfallPaise: number | null;
}

export interface DeskCounts {
  pendingReview: number;
  onHold: number;
  approvedAwaitingExport: number;
  approvedToday: number;
  exportedToday: number;
}

export const DORMANT_DAYS = 14;

export interface DormantRetailer {
  id: string;
  shopName: string;
  name: string;
  area: string;
  phone: string;
  lastOrderAt: Date | null;
  daysSince: number | null;
}

export async function deskCounts(db: Db, now: Date = new Date()): Promise<DeskCounts> {
  const { start, end } = istDayRange(now);
  const [pendingReview, onHold, approvedAwaitingExport, approvedToday, exportedToday] = await Promise.all([
    db.order.count({ where: { status: "PENDING_DESK_REVIEW" } }),
    db.order.count({ where: { status: "ON_HOLD" } }),
    db.order.count({ where: { status: "CONFIRMED" } }),
    db.order.count({ where: { status: "CONFIRMED", approvedAt: { gte: start, lt: end } } }),
    db.order.count({ where: { status: "EXPORTED", exportedAt: { gte: start, lt: end } } }),
  ]);
  return { pendingReview, onHold, approvedAwaitingExport, approvedToday, exportedToday };
}

export async function deskQueue(db: Db, status: QueueStatus | null, take = 100): Promise<QueueRow[]> {
  const orders = await db.order.findMany({
    where: { status: status ?? { in: [...QUEUE_STATUSES] } },
    orderBy: { createdAt: "desc" },
    take,
    include: {
      retailer: { select: { id: true, shopName: true, area: true, creditLimitPaise: true, creditUsedPaise: true } },
      _count: { select: { lines: true } },
    },
  });
  return orders.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    createdAt: o.createdAt,
    status: o.status,
    source: o.source,
    retailer: { id: o.retailer.id, shopName: o.retailer.shopName, area: o.retailer.area },
    lineCount: o._count.lines,
    grandTotalPaise: o.grandTotalPaise,
    creditShortfallPaise:
      o.status === "PENDING_DESK_REVIEW" || o.status === "ON_HOLD"
        ? currentShortfallPaise(o.retailer, o.grandTotalPaise, o.status)
        : null,
  }));
}

/** Retailers with no submitted order in the last 14 days (or none at all), longest silent first. */
export async function dormantRetailers(db: Db, now: Date = new Date(), days = DORMANT_DAYS): Promise<DormantRetailer[]> {
  const [retailers, last] = await Promise.all([
    db.retailer.findMany({ select: { id: true, shopName: true, name: true, area: true, phone: true } }),
    db.order.groupBy({ by: ["retailerId"], where: { status: { not: "DRAFT" } }, _max: { createdAt: true } }),
  ]);
  const lastBy = new Map(last.map((l) => [l.retailerId, l._max.createdAt]));
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  return retailers
    .map((r) => {
      const lastOrderAt = lastBy.get(r.id) ?? null;
      return { ...r, lastOrderAt, daysSince: lastOrderAt ? daysBetween(lastOrderAt, now) : null };
    })
    .filter((r) => !r.lastOrderAt || r.lastOrderAt.getTime() < cutoff)
    .sort((a, b) => (a.lastOrderAt?.getTime() ?? 0) - (b.lastOrderAt?.getTime() ?? 0));
}

/** Everything the review screen needs. */
export async function deskOrderDetail(db: Db, orderId: string) {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      retailer: true,
      lines: { orderBy: { skuName: "asc" } },
      statusEvents: { orderBy: { createdAt: "asc" } },
      lineCorrections: { orderBy: { createdAt: "asc" } },
      tallyExports: { orderBy: { exportedAt: "desc" }, select: { id: true, exportedAt: true, exportedBy: true, batchId: true } },
      aiCaptures: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, rawText: true, engine: true, model: true, createdAt: true } },
    },
  });
  if (!order) return null;
  return {
    ...order,
    currentShortfallPaise: currentShortfallPaise(order.retailer, order.grandTotalPaise, order.status),
  };
}
export type DeskOrderDetail = NonNullable<Awaited<ReturnType<typeof deskOrderDetail>>>;
