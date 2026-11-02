"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useCart } from "@/lib/cart/cart-store";
import { useQuote } from "@/lib/cart/use-quote";
import { fmt } from "@/lib/i18n-format";
import { formatINR } from "@/lib/money";
import { LineMoney, SchemeChips, unavailableText, type CartLineMessages } from "./cart-line";
import { QtyStepper } from "./qty-stepper";
import { EmptyState, ErrorPanel, SkeletonList } from "./states";
import { TotalsCard } from "./totals-card";

export function CartView({ m }: { m: CartLineMessages }) {
  const cart = useCart();
  const { state, refresh } = useQuote(cart.items);
  const [removedNotice, setRemovedNotice] = useState(false);

  // Drop items that left the catalogue, and tell the retailer.
  const unknown = state.kind === "ready" ? state.quote.unknownSkuIds : [];
  useEffect(() => {
    if (unknown.length > 0) {
      cart.removeMany(unknown);
      setRemovedNotice(true);
    }
  }, [unknown.join(","), cart]); // eslint-disable-line react-hooks/exhaustive-deps

  if (cart.items.length === 0) {
    return (
      <>
        {removedNotice && <Notice text={m.cart.removedItems} />}
        <EmptyState icon="🧺" title={m.cart.empty} body={m.cart.emptyHint} action={{ href: "/retailer/catalogue", label: m.cart.browse }} />
      </>
    );
  }
  if (state.kind === "loading" || state.kind === "idle") return <SkeletonList rows={Math.min(cart.items.length, 4)} label={m.common.loading} />;
  if (state.kind === "error") {
    return state.reason === "auth" ? (
      <ErrorPanel title={m.common.errorTitle} body={m.common.sessionExpired} action={{ href: "/login", label: m.common.loginAgain }} />
    ) : (
      <ErrorPanel title={m.common.errorTitle} body={m.common.networkError} onRetry={refresh} retryLabel={m.common.retry} />
    );
  }

  const { quote, updating } = state;
  return (
    <div>
      {removedNotice && <Notice text={m.cart.removedItems} />}
      <p aria-live="polite" className={`mb-2 h-5 text-sm text-slate-500 ${updating ? "" : "invisible"}`}>
        {m.cart.updating}
      </p>
      <ul className="space-y-3">
        {quote.lines.map((line) => (
          <li key={line.skuId} className={`rounded-xl bg-white p-3 ring-1 ${line.orderable ? "ring-slate-200" : "ring-red-300"}`}>
            <div className="flex gap-3">
              <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-2xl">
                {line.imageEmoji ?? "📦"}
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold leading-snug">{line.name}</h2>
                <p className="text-xs text-slate-600">
                  {formatINR(line.unitPricePaise)} {fmt(m.common.perCaseOf, { n: line.caseSize })} · {m.common.exclGst}
                </p>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <QtyStepper
                value={cart.qtyOf(line.skuId) || line.qtyCases}
                onChange={(n) => cart.setQty(line.skuId, n)}
                labels={m.catalogue}
                idSuffix={line.skuId}
              />
              <button
                type="button"
                onClick={() => cart.setQty(line.skuId, 0)}
                className="min-h-11 px-3 text-sm font-medium text-red-700 underline"
              >
                {m.cart.remove}
              </button>
            </div>

            <div className="mt-2 space-y-2">
              {line.orderable ? (
                <>
                  <SchemeChips line={line} m={m} />
                  {line.freeCases > 0 && <p className="text-xs text-slate-600">{fmt(m.cart.ships, { n: line.shippedCases })}</p>}
                  <LineMoney line={line} m={m} />
                </>
              ) : (
                <p className="rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                  {m.cart.unavailable}: {unavailableText(line, m)}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>

      <TotalsCard totals={quote.totals} m={m} />

      <Link
        href="/retailer/checkout"
        className="mt-4 flex min-h-12 items-center justify-center rounded-md bg-brand-600 text-base font-semibold text-white active:bg-brand-700"
      >
        {m.cart.checkout} →
      </Link>
    </div>
  );
}

function Notice({ text }: { text: string }) {
  return <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">{text}</p>;
}
