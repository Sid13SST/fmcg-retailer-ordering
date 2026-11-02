import type { OrderTotals } from "@/lib/pricing";
import { formatINR } from "@/lib/money";
import type { CartLineMessages } from "./cart-line";

export function TotalsCard({ totals, m }: { totals: OrderTotals; m: CartLineMessages }) {
  const row = "flex justify-between gap-2";
  return (
    <section className="mt-4 rounded-xl bg-white p-4 ring-1 ring-slate-200">
      <dl className="space-y-1 text-sm tabular-nums">
        <div className={row}>
          <dt className="text-slate-600">{m.cart.totalCases}</dt>
          <dd>{totals.totalCases}</dd>
        </div>
        {totals.totalFreeCases > 0 && (
          <div className={`${row} text-emerald-700`}>
            <dt>{m.cart.freeCasesTotal}</dt>
            <dd>+{totals.totalFreeCases}</dd>
          </div>
        )}
        {totals.discountPaise > 0 && (
          <div className={`${row} text-emerald-700`}>
            <dt>{m.cart.discount}</dt>
            <dd>−{formatINR(totals.discountPaise)}</dd>
          </div>
        )}
        <div className={row}>
          <dt className="text-slate-600">{m.cart.subtotal}</dt>
          <dd>{formatINR(totals.subtotalPaise)}</dd>
        </div>
        <div className={row}>
          <dt className="text-slate-600">{m.cart.gst}</dt>
          <dd>{formatINR(totals.gstPaise)}</dd>
        </div>
        <div className={`${row} border-t border-slate-200 pt-2 text-base font-bold`}>
          <dt>{m.cart.grandTotal}</dt>
          <dd>{formatINR(totals.grandTotalPaise)}</dd>
        </div>
      </dl>
    </section>
  );
}
