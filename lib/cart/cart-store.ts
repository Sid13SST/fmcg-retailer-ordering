"use client";

/**
 * Browser cart: only { skuId, qtyCases } is stored (localStorage, per retailer).
 * Prices, schemes and stock always come from the server quote, never from here.
 */
import { createContext, createElement, useCallback, useContext, useMemo, useSyncExternalStore } from "react";

export interface CartItem {
  skuId: string;
  qtyCases: number;
}

const MAX_QTY = 9999;
const EMPTY: CartItem[] = [];
const listeners = new Set<() => void>();
const cache = new Map<string, CartItem[]>();

const keyFor = (ownerId: string) => `kod_cart_v1:${ownerId}`;

function read(ownerId: string): CartItem[] {
  const cached = cache.get(ownerId);
  if (cached) return cached;
  let items: CartItem[] = EMPTY;
  try {
    const raw = window.localStorage.getItem(keyFor(ownerId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      items = parsed.filter(
        (i): i is CartItem =>
          typeof i?.skuId === "string" && Number.isInteger(i?.qtyCases) && i.qtyCases > 0 && i.qtyCases <= MAX_QTY,
      );
    }
  } catch {
    items = EMPTY; // storage blocked or corrupt: start empty
  }
  cache.set(ownerId, items);
  return items;
}

function write(ownerId: string, items: CartItem[]) {
  cache.set(ownerId, items);
  try {
    window.localStorage.setItem(keyFor(ownerId), JSON.stringify(items));
  } catch {
    // storage full/blocked: cart still works for this page view
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key?.startsWith("kod_cart_v1:")) {
      cache.clear();
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

const OwnerContext = createContext<string | null>(null);

export function CartProvider({ ownerId, children }: { ownerId: string; children: React.ReactNode }) {
  return createElement(OwnerContext.Provider, { value: ownerId }, children);
}

export function useCart() {
  const ownerId = useContext(OwnerContext);
  if (!ownerId) throw new Error("useCart must be used inside CartProvider");

  const items = useSyncExternalStore(
    subscribe,
    () => read(ownerId),
    () => EMPTY,
  );

  const setQty = useCallback(
    (skuId: string, qtyCases: number) => {
      const qty = Math.max(0, Math.min(MAX_QTY, Math.floor(qtyCases)));
      const current = read(ownerId);
      const next =
        qty === 0
          ? current.filter((i) => i.skuId !== skuId)
          : current.some((i) => i.skuId === skuId)
            ? current.map((i) => (i.skuId === skuId ? { ...i, qtyCases: qty } : i))
            : [...current, { skuId, qtyCases: qty }];
      write(ownerId, next);
    },
    [ownerId],
  );

  const removeMany = useCallback(
    (skuIds: string[]) => write(ownerId, read(ownerId).filter((i) => !skuIds.includes(i.skuId))),
    [ownerId],
  );
  const replace = useCallback((next: CartItem[]) => write(ownerId, next), [ownerId]);
  const clear = useCallback(() => write(ownerId, EMPTY), [ownerId]);

  return useMemo(
    () => ({
      items,
      count: items.length,
      qtyOf: (skuId: string) => items.find((i) => i.skuId === skuId)?.qtyCases ?? 0,
      setQty,
      removeMany,
      replace,
      clear,
    }),
    [items, setQty, removeMany, replace, clear],
  );
}
