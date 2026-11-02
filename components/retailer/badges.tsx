import type { OrderStatus } from "@prisma/client";

export const LOW_STOCK_THRESHOLD = 20;

export type StockLevel = "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK";

export function stockLevel(stockCases: number): StockLevel {
  if (stockCases <= 0) return "OUT_OF_STOCK";
  if (stockCases < LOW_STOCK_THRESHOLD) return "LOW_STOCK";
  return "IN_STOCK";
}

const STOCK_STYLE: Record<StockLevel, string> = {
  IN_STOCK: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  LOW_STOCK: "bg-amber-50 text-amber-800 ring-amber-200",
  OUT_OF_STOCK: "bg-slate-100 text-slate-600 ring-slate-300",
};

export function StockBadge({ level, label }: { level: StockLevel; label: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${STOCK_STYLE[level]}`}>
      <span aria-hidden className="mr-1">
        {level === "OUT_OF_STOCK" ? "✕" : level === "LOW_STOCK" ? "!" : "●"}
      </span>
      {label}
    </span>
  );
}

export function SchemeBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-md bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700 ring-1 ring-brand-100">
      🎁 {label}
    </span>
  );
}

const STATUS_STYLE: Record<OrderStatus, string> = {
  DRAFT: "bg-slate-100 text-slate-700 ring-slate-300",
  PENDING_DESK_REVIEW: "bg-sky-50 text-sky-800 ring-sky-200",
  ON_HOLD: "bg-amber-50 text-amber-800 ring-amber-300",
  CONFIRMED: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  EXPORTED: "bg-indigo-50 text-indigo-800 ring-indigo-200",
  REJECTED: "bg-red-50 text-red-700 ring-red-200",
};

export function StatusBadge({ status, label }: { status: OrderStatus; label: string }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${STATUS_STYLE[status]}`}>
      {label}
    </span>
  );
}
