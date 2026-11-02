import type { OrderSource, OrderStatus } from "@prisma/client";
import { StatusBadge } from "@/components/retailer/badges";
import { formatINR } from "@/lib/money";

export const DESK_STATUS_LABEL: Record<OrderStatus, string> = {
  DRAFT: "Draft",
  PENDING_DESK_REVIEW: "Pending review",
  ON_HOLD: "On hold",
  CONFIRMED: "Approved",
  EXPORTED: "Exported",
  REJECTED: "Rejected",
};

export function DeskStatusBadge({ status }: { status: OrderStatus }) {
  return <StatusBadge status={status} label={DESK_STATUS_LABEL[status]} />;
}

export function SourceBadge({ source }: { source: OrderSource }) {
  return source === "AI_TEXT" ? (
    <span className="inline-flex items-center whitespace-nowrap rounded-md bg-violet-50 px-2 py-0.5 text-xs font-semibold text-violet-800 ring-1 ring-violet-200">
      AI capture
    </span>
  ) : (
    <span className="inline-flex items-center whitespace-nowrap rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">
      Catalogue
    </span>
  );
}

/** Credit status for an order still awaiting a desk decision; null = settled. */
export function CreditStatus({ shortfallPaise }: { shortfallPaise: number | null }) {
  if (shortfallPaise === null) return <span className="text-xs text-slate-400">—</span>;
  if (shortfallPaise === 0) return <span className="whitespace-nowrap text-xs font-medium text-emerald-700">Within limit</span>;
  return <span className="whitespace-nowrap text-xs font-semibold text-red-700">Over by {formatINR(shortfallPaise)}</span>;
}

export function formatIST(d: Date): string {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(d);
}
