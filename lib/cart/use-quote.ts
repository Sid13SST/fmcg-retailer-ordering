"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Quote } from "@/lib/orders/quote";
import type { CartItem } from "./cart-store";

export type QuoteState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; quote: Quote; updating: boolean }
  | { kind: "error"; reason: "network" | "auth" | "server" };

/** Fetch a server quote for the cart, debounced, cancelling stale requests. */
export function useQuote(items: CartItem[], debounceMs = 300) {
  const [state, setState] = useState<QuoteState>({ kind: "idle" });
  const [nonce, setNonce] = useState(0);
  const lastQuote = useRef<Quote | null>(null);
  const key = JSON.stringify(items);

  useEffect(() => {
    if (items.length === 0) {
      lastQuote.current = null;
      setState({ kind: "idle" });
      return;
    }
    const controller = new AbortController();
    setState(lastQuote.current ? { kind: "ready", quote: lastQuote.current, updating: true } : { kind: "loading" });
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/retailer/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lines: items }),
          signal: controller.signal,
        });
        if (res.status === 401 || res.status === 403) return setState({ kind: "error", reason: "auth" });
        if (!res.ok) return setState({ kind: "error", reason: "server" });
        const quote = (await res.json()) as Quote;
        lastQuote.current = quote;
        setState({ kind: "ready", quote, updating: false });
      } catch (err) {
        if ((err as Error).name !== "AbortError") setState({ kind: "error", reason: "network" });
      }
    }, lastQuote.current ? debounceMs : 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` captures items by value
  }, [key, nonce, debounceMs]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return { state, refresh };
}

/** RFC 4122 v4 id; works on plain-http LAN where crypto.randomUUID is unavailable. */
export function newRequestId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
