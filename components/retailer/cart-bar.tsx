"use client";

import Link from "next/link";
import { useCart } from "@/lib/cart/cart-store";
import { useQuote } from "@/lib/cart/use-quote";
import { plural } from "@/lib/i18n-format";
import { formatINR } from "@/lib/money";

export interface CartBarLabels {
  itemsOne: string;
  itemsMany: string;
  total: string;
  updating: string;
}

/**
 * Sticky summary pinned just above the bottom nav: item count, server-priced grand total
 * and one large primary action. Renders a spacer so it never covers the last card.
 */
export function CartSummaryBar({
  itemCount,
  totalPaise,
  updating,
  href,
  cta,
  labels,
}: {
  itemCount: number;
  totalPaise: number | null;
  updating: boolean;
  href: string;
  cta: string;
  labels: CartBarLabels;
}) {
  return (
    <>
      <div aria-hidden className="h-20" />
      <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-10 border-t border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-2">
          <div className="min-w-0" aria-live="polite">
            <p className="text-xs text-slate-600">
              {plural(itemCount, labels.itemsOne, labels.itemsMany)} · {labels.total}
            </p>
            <p className={`price ${updating ? "text-slate-400" : ""}`}>
              {totalPaise === null ? "…" : formatINR(totalPaise)}
              {updating && <span className="sr-only"> {labels.updating}</span>}
            </p>
          </div>
          <Link href={href} className="btn btn-lg btn-primary shrink-0 px-5">
            {cta} →
          </Link>
        </div>
      </div>
    </>
  );
}

/** Catalogue variant: prices the cart on the server (debounced) as the retailer adds items. */
export function CatalogueCartBar({ cta, labels }: { cta: string; labels: CartBarLabels }) {
  const cart = useCart();
  const { state } = useQuote(cart.items, 400);
  if (cart.count === 0) return null;
  const total = state.kind === "ready" ? state.quote.totals.grandTotalPaise : null;
  const updating = state.kind === "loading" || (state.kind === "ready" && state.updating);
  return <CartSummaryBar itemCount={cart.count} totalPaise={total} updating={updating} href="/retailer/cart" cta={cta} labels={labels} />;
}
