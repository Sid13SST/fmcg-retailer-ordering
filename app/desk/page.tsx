import Link from "next/link";
import { BulkExportButton } from "@/components/desk/bulk-export-button";
import { CreditStatus, DeskStatusBadge, DESK_STATUS_LABEL, formatIST, SourceBadge } from "@/components/desk/labels";
import { prisma } from "@/lib/db";
import { deskCounts, deskQueue, dormantRetailers, DORMANT_DAYS, parseQueueStatus, QUEUE_STATUSES } from "@/lib/desk/queries";
import { formatINR } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function DeskDashboard({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const status = parseQueueStatus((await searchParams).status);
  const [counts, queue, dormant] = await Promise.all([deskCounts(prisma), deskQueue(prisma, status), dormantRetailers(prisma)]);

  const tiles = [
    { label: "Pending review", value: counts.pendingReview, href: "/desk?status=PENDING_DESK_REVIEW", style: "border-l-sky-500" },
    { label: "On credit hold", value: counts.onHold, href: "/desk?status=ON_HOLD", style: "border-l-amber-500" },
    {
      label: "Approved, not exported",
      value: counts.approvedAwaitingExport,
      href: "/desk?status=CONFIRMED",
      style: "border-l-emerald-500",
      hint: `${counts.approvedToday} approved today`,
    },
    { label: "Exported today", value: counts.exportedToday, href: "/desk?status=EXPORTED", style: "border-l-slate-400" },
  ];
  const filters: Array<{ key: string | null; label: string }> = [{ key: null, label: "All" }, ...QUEUE_STATUSES.map((s) => ({ key: s, label: DESK_STATUS_LABEL[s] }))];

  return (
    <div className="space-y-6">
      <section aria-label="Today at a glance" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} className={`card border-l-4 p-4 hover:bg-slate-50 ${t.style}`}>
            <p className="text-xs font-medium text-slate-600">{t.label}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{t.value}</p>
            {t.hint && <p className="text-xs text-slate-500">{t.hint}</p>}
          </Link>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <section aria-labelledby="queue-title" className="min-w-0 rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 id="queue-title" className="text-base font-semibold">Incoming orders</h2>
              <p className="text-xs text-slate-500">Newest first. Totals incl. GST (demo rates).</p>
            </div>
            <BulkExportButton count={counts.approvedToday} />
          </div>

          <nav aria-label="Filter by status" className="flex flex-wrap gap-2 border-b border-slate-100 px-4 py-2">
            {filters.map((f) => {
              const active = f.key === status;
              return (
                <Link
                  key={f.label}
                  href={f.key ? `/desk?status=${f.key}` : "/desk"}
                  aria-current={active ? "page" : undefined}
                  className={`inline-flex min-h-9 items-center whitespace-nowrap rounded-full px-3 text-sm ${
                    active ? "bg-slate-900 font-semibold text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  {f.label}
                </Link>
              );
            })}
          </nav>

          {queue.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-500">No orders {status ? `with status “${DESK_STATUS_LABEL[status]}”` : "yet"}.</p>
          ) : (
            <>
            {/* Phones: one card per order, nothing scrolls sideways. */}
            <ul className="divide-y divide-slate-100 md:hidden">
              {queue.map((o) => (
                <li key={o.id}>
                  <Link href={`/desk/orders/${o.id}`} className="block px-4 py-3 active:bg-slate-50">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-brand-700">{o.orderNumber}</p>
                        <p className="truncate text-sm font-medium">{o.retailer.shopName}</p>
                      </div>
                      <p className="shrink-0 text-base font-semibold tabular-nums">{formatINR(o.grandTotalPaise)}</p>
                    </div>
                    <p className="text-xs text-slate-500">
                      {formatIST(o.createdAt)} · {o.retailer.area} · {o.lineCount} line{o.lineCount === 1 ? "" : "s"}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <DeskStatusBadge status={o.status} />
                      <SourceBadge source={o.source} />
                      <CreditStatus shortfallPaise={o.creditShortfallPaise} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="hidden md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-2 font-medium">Order</th>
                    <th className="px-4 py-2 font-medium">Retailer</th>
                    <th className="px-4 py-2 font-medium">Source</th>
                    <th className="px-4 py-2 text-right font-medium">Total</th>
                    <th className="px-4 py-2 font-medium">Credit</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.map((o) => (
                    <tr key={o.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-2 align-top">
                        <Link href={`/desk/orders/${o.id}`} className="font-semibold text-brand-700 hover:underline">
                          {o.orderNumber}
                        </Link>
                        <p className="text-xs text-slate-500">{formatIST(o.createdAt)}</p>
                      </td>
                      <td className="px-4 py-2 align-top">
                        <p className="font-medium">{o.retailer.shopName}</p>
                        <p className="text-xs text-slate-500">
                          {o.retailer.area} · {o.lineCount} line{o.lineCount === 1 ? "" : "s"}
                        </p>
                      </td>
                      <td className="px-4 py-2 align-top"><SourceBadge source={o.source} /></td>
                      <td className="num px-4 py-2 align-top font-semibold">{formatINR(o.grandTotalPaise)}</td>
                      <td className="px-4 py-2 align-top"><CreditStatus shortfallPaise={o.creditShortfallPaise} /></td>
                      <td className="px-4 py-2 align-top"><DeskStatusBadge status={o.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
        </section>

        <aside aria-labelledby="dormant-title" className="h-fit rounded-xl border border-slate-200 bg-white p-4">
          <h2 id="dormant-title" className="text-base font-semibold">No order in {DORMANT_DAYS} days</h2>
          <p className="mb-2 text-xs text-slate-500">Worth a call or a salesman visit.</p>
          {dormant.length === 0 ? (
            <p className="text-sm text-slate-500">Every retailer has ordered recently.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {dormant.map((r) => (
                <li key={r.id} className="py-2 text-sm">
                  <p className="font-medium">{r.shopName}</p>
                  <p className="text-xs text-slate-500">
                    {r.name} · {r.area} · <a href={`tel:+91${r.phone}`} className="text-brand-700 underline">{r.phone}</a>
                  </p>
                  <p className="text-xs text-amber-700">
                    {r.lastOrderAt ? `Last order ${r.daysSince} days ago (${formatIST(r.lastOrderAt)})` : "Has never ordered"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
