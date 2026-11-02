"use client";

import { useCart } from "@/lib/cart/cart-store";
import { QtyStepper, type QtyLabels } from "./qty-stepper";

export function AddToCart({
  skuId,
  orderable,
  maxCases,
  labels,
}: {
  skuId: string;
  orderable: boolean;
  maxCases: number;
  labels: QtyLabels & { add: string; notAvailable: string; inCart: string };
}) {
  const cart = useCart();
  const qty = cart.qtyOf(skuId);

  if (!orderable) {
    return (
      <span className="flex h-11 items-center justify-center rounded-md bg-slate-100 px-4 text-sm font-medium text-slate-500">
        {labels.notAvailable}
      </span>
    );
  }
  if (qty === 0) {
    return (
      <button
        type="button"
        onClick={() => cart.setQty(skuId, 1)}
        className="h-11 min-w-24 rounded-md bg-brand-600 px-5 text-base font-semibold text-white active:bg-brand-700"
      >
        {labels.add}
      </button>
    );
  }
  return (
    <div className="flex flex-col items-end gap-0.5">
      <QtyStepper value={qty} onChange={(n) => cart.setQty(skuId, n)} labels={labels} max={maxCases} idSuffix={skuId} />
      <span className="text-[11px] font-medium text-brand-700">{labels.inCart}</span>
    </div>
  );
}
