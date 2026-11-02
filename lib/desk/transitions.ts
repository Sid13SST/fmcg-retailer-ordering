/**
 * Order status transitions the desk may perform. Pure; enforced server-side by
 * every desk action (the UI only hides buttons that would be refused anyway).
 */
import type { OrderStatus } from "@prisma/client";

export const DESK_ACTIONS = ["APPROVE", "HOLD", "REJECT", "CORRECT_LINE", "EXPORT"] as const;
export type DeskAction = (typeof DESK_ACTIONS)[number];

/** Statuses each action may start from. Anything else is refused (409). */
export const ALLOWED_FROM: Record<DeskAction, readonly OrderStatus[]> = {
  APPROVE: ["PENDING_DESK_REVIEW", "ON_HOLD"],
  HOLD: ["PENDING_DESK_REVIEW"],
  // A confirmed order can still be stopped before it reaches Tally (A23).
  REJECT: ["PENDING_DESK_REVIEW", "ON_HOLD", "CONFIRMED"],
  CORRECT_LINE: ["PENDING_DESK_REVIEW", "ON_HOLD"],
  EXPORT: ["CONFIRMED"],
};

export const RESULTING_STATUS: Partial<Record<DeskAction, OrderStatus>> = {
  APPROVE: "CONFIRMED",
  HOLD: "ON_HOLD",
  REJECT: "REJECTED",
  EXPORT: "EXPORTED",
};

export function canPerform(action: DeskAction, status: OrderStatus): boolean {
  return ALLOWED_FROM[action].includes(status);
}

/** Actions available for an order in this status, for the review screen. */
export function availableActions(status: OrderStatus): DeskAction[] {
  return DESK_ACTIONS.filter((a) => canPerform(a, status));
}

/** Statuses that hold reserved credit (A10): placed within limit, or approved by the desk. */
export function holdsReservedCredit(status: OrderStatus): boolean {
  return status === "PENDING_DESK_REVIEW" || status === "CONFIRMED" || status === "EXPORTED";
}
