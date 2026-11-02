import Link from "next/link";
import { StatusBadge } from "@/components/retailer/badges";
import { EmptyState } from "@/components/retailer/states";
import { getSession } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/i18n";
import { fmt, plural } from "@/lib/i18n-format";
import { getI18n } from "@/lib/i18n-server";
import { formatINR } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const session = (await getSession())!; // layout guarantees a retailer session
  const { locale, m } = await getI18n();
  const orders = await prisma.order.findMany({
    where: { retailerId: session.sub },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { _count: { select: { lines: true } } },
  });

  return (
    <main>
      <h1 className="mb-3 text-xl font-bold">{m.orders.title}</h1>
      {orders.length === 0 ? (
        <EmptyState icon="📦" title={m.orders.empty} body={m.orders.emptyHint} action={{ href: "/retailer/catalogue", label: m.cart.browse }} />
      ) : (
        <ul className="space-y-2">
          {orders.map((o) => (
            <li key={o.id}>
              <Link
                href={`/retailer/orders/${o.id}`}
                className="block rounded-xl bg-white p-3 ring-1 ring-slate-200 active:bg-slate-50"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">{o.orderNumber}</p>
                    <p className="text-xs text-slate-600">{fmt(m.orders.placedOn, { date: formatDateTime(o.createdAt, locale) })}</p>
                  </div>
                  <StatusBadge status={o.status} label={m.status[o.status]} />
                </div>
                <div className="mt-2 flex items-end justify-between gap-2 text-sm">
                  <span className="text-slate-600">
                    {plural(o._count.lines, m.orders.itemsOne, m.orders.itemsMany)}
                    {o.source === "AI_TEXT" && <> · {m.orders.viaWhatsapp}</>}
                  </span>
                  <span className="text-base font-bold tabular-nums">{formatINR(o.grandTotalPaise)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
