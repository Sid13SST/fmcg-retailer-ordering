import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/retailer/badges";
import { getSession } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/i18n";
import { fmt, plural } from "@/lib/i18n-format";
import { getI18n } from "@/lib/i18n-server";
import { formatINR } from "@/lib/money";
import { DemoGstNote } from "@/components/retailer/totals-card";
import { gstBreakup } from "@/lib/orders/gst-breakup";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ placed?: string }>;
}) {
  const [{ id }, { placed }] = await Promise.all([params, searchParams]);
  const session = (await getSession())!;
  const { locale, m } = await getI18n();

  // Scoped to the logged-in retailer: another retailer's order is a 404.
  const order = await prisma.order.findFirst({
    where: { id: id.slice(0, 64), retailerId: session.sub },
    include: {
      lines: { orderBy: { skuName: "asc" } },
      statusEvents: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!order) notFound();

  const breakup = gstBreakup(order.lines);
  const totalFree = order.lines.reduce((s, l) => s + l.freeCases, 0);
  const row = "flex justify-between gap-2";

  return (
    <main>
      <Link href="/retailer/orders" className="inline-flex min-h-11 items-center text-sm font-medium text-brand-700">
        ← {m.orders.backToOrders}
      </Link>

      {placed === "1" && (
        <p
          role="status"
          className={`mb-3 rounded-lg px-3 py-3 text-sm font-semibold ${
            order.status === "ON_HOLD" ? "bg-amber-100 text-amber-900" : "bg-emerald-50 text-emerald-800"
          }`}
        >
          {fmt(order.status === "ON_HOLD" ? m.orders.holdBanner : m.orders.placedBanner, { no: order.orderNumber })}
        </p>
      )}

      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">{fmt(m.orders.detailTitle, { no: order.orderNumber })}</h1>
          <p className="text-sm text-slate-600">{fmt(m.orders.placedOn, { date: formatDateTime(order.createdAt, locale) })}</p>
          {order.source === "AI_TEXT" && <p className="text-xs text-slate-500">{m.orders.viaWhatsapp}</p>}
        </div>
        <StatusBadge status={order.status} label={m.status[order.status]} />
      </div>

      {order.status === "ON_HOLD" && order.holdReason && (
        <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
          <strong>{m.orders.holdReason}:</strong> {order.holdReason}
        </p>
      )}
      {order.notes && (
        <p className="mt-3 rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">
          <strong>{m.orders.shortNote}:</strong> {order.notes}
        </p>
      )}

      <section className="mt-4 rounded-xl bg-white p-3 ring-1 ring-slate-200">
        <h2 className="mb-1 font-semibold">{m.orders.lines}</h2>
        <ul className="divide-y divide-slate-100">
          {order.lines.map((l) => (
            <li key={l.id} className="py-2 text-sm">
              <div className="flex justify-between gap-2">
                <span className="min-w-0 font-medium">{l.skuName}</span>
                <span className="shrink-0 font-semibold tabular-nums">{formatINR(l.totalPaise)}</span>
              </div>
              <p className="text-xs text-slate-600">
                {plural(l.qtyCases, m.common.caseOne, m.common.caseMany)} ×{" "}
                {fmt(m.orders.unitPrice, { price: formatINR(l.unitPricePaise), n: l.caseSize, gst: m.common.exclGst })}
              </p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {l.freeCases > 0 && (
                  <span className="rounded-md bg-emerald-600 px-2 py-0.5 text-xs font-bold text-white">
                    {plural(l.freeCases, m.cart.freeOne, m.cart.freeMany)}
                  </span>
                )}
                {l.discountPercent > 0 && (
                  <span className="rounded-md bg-emerald-600 px-2 py-0.5 text-xs font-bold text-white">
                    {fmt(m.cart.slabApplied, { p: l.discountPercent })} (−{formatINR(l.discountPaise)})
                  </span>
                )}
                <span className="text-xs text-slate-500">
                  {m.cart.subtotal}: {formatINR(l.subtotalPaise)} · {fmt(m.cart.gstAt, { r: l.gstRatePercent })}: {formatINR(l.gstPaise)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-4 rounded-xl bg-white p-3 ring-1 ring-slate-200">
        <h2 className="mb-1 font-semibold">{m.orders.gstBreakup}</h2>
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="text-left text-xs text-slate-500">
              <th className="py-1 font-medium">{m.orders.rate}</th>
              <th className="py-1 text-right font-medium">{m.orders.taxable}</th>
              <th className="py-1 text-right font-medium">{m.orders.tax}</th>
            </tr>
          </thead>
          <tbody>
            {breakup.map((r) => (
              <tr key={r.ratePercent} className="border-t border-slate-100">
                <td className="py-1">{r.ratePercent}%</td>
                <td className="py-1 text-right">{formatINR(r.taxablePaise)}</td>
                <td className="py-1 text-right">{formatINR(r.gstPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <DemoGstNote text={m.common.demoGstNote} />
      </section>

      <section className="mt-4 rounded-xl bg-white p-4 ring-1 ring-slate-200">
        <h2 className="mb-1 font-semibold">{m.orders.totals}</h2>
        <dl className="space-y-1 text-sm tabular-nums">
          {totalFree > 0 && (
            <div className={`${row} text-emerald-700`}>
              <dt>{m.cart.freeCasesTotal}</dt>
              <dd>+{totalFree}</dd>
            </div>
          )}
          {order.discountPaise > 0 && (
            <div className={`${row} text-emerald-700`}>
              <dt>{m.cart.discount}</dt>
              <dd>−{formatINR(order.discountPaise)}</dd>
            </div>
          )}
          <div className={row}>
            <dt className="text-slate-600">{m.cart.subtotal}</dt>
            <dd>{formatINR(order.subtotalPaise)}</dd>
          </div>
          <div className={row}>
            <dt className="text-slate-600">{m.cart.gst}</dt>
            <dd>{formatINR(order.gstPaise)}</dd>
          </div>
          <div className={`${row} border-t border-slate-200 pt-2 text-base font-bold`}>
            <dt>{m.cart.grandTotal}</dt>
            <dd>{formatINR(order.grandTotalPaise)}</dd>
          </div>
        </dl>
        <DemoGstNote text={m.common.demoGstNote} />
      </section>

      <section className="mt-4 rounded-xl bg-white p-3 ring-1 ring-slate-200">
        <h2 className="mb-2 font-semibold">{m.orders.history}</h2>
        <ol className="relative ml-2 border-l border-slate-200">
          {order.statusEvents.map((e) => (
            <li key={e.id} className="mb-3 ml-4 last:mb-0">
              <span aria-hidden className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full bg-brand-500" />
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={e.toStatus} label={m.status[e.toStatus]} />
                <span className="text-xs text-slate-500">
                  {formatDateTime(e.createdAt, locale)} · {e.actorRole === "RETAILER" ? m.orders.byRetailer : m.orders.byDesk}
                </span>
              </div>
              {e.note && <p className="mt-1 text-sm text-slate-700">{e.note}</p>}
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
