"use client";

import { useCart } from "@/lib/cart/cart-store";

export function CartCount() {
  const { count } = useCart();
  if (count === 0) return null;
  return (
    <span className="ml-1 inline-flex min-w-5 items-center justify-center rounded-full bg-brand-600 px-1.5 text-xs font-semibold text-white">
      {count}
    </span>
  );
}
