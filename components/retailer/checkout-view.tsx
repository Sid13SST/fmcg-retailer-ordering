"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { CreateOrderResult, StockIssue } from "@/lib/orders/create-order";
import type { CreditPreview, QuoteSummary } from "@/lib/orders/quote";
import type { Messages } from "@/lib/i18n";
import { useCart } from "@/lib/cart/cart-store";
import { newRequestId, useQuote } from "@/lib/cart/use-quote";
import { fmt, plural } from "@/lib/i18n-format";
import { formatINR } from "@/lib/money";
import { SchemeChips } from "./cart-line";
import { EmptyState, ErrorPanel, SkeletonList } from "./states";
import { TotalsCard } from "./totals-card";

export type CheckoutMessages = Pick<Messages, "cart" | "common" | "catalogue" | "checkout">;

type PlaceError =
  | { kind: "stock"; issues: StockIssue[] }
  | { kind: "message"; text: string };

export function CheckoutView({ m }: { m: CheckoutMessages }) {
  const router = useRouter();
  const cart = useCart();
  const { state, refresh } = useQuote(cart.items, 0);
  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState<PlaceError | null>(null);
  const requestId = useRef<string>(newRequestId());

  if (cart.items.length === 0 && !placing) {
    return <EmptyState icon="🧺" title={m.cart.empty} body={m.cart.emptyHint} action={{ href: "/retailer/catalogue", label: m.cart.browse }} />;
  }
  if (state.kind === "loading" || state.kind === "idle") return <SkeletonList rows={2} label={m.common.loading} />;
  if (state.kind === "error") {
    return state.reason === "auth" ? (
      <ErrorPanel title={m.common.errorTitle} body={m.common.sessionExpired} action={{ href: "/login", label: m.common.loginAgain }} />
    ) : (
      <ErrorPanel title={m.common.errorTitle} body={m.common.networkError} onRetry={refresh} retryLabel={m.common.retry} />
    );
  }

  const { quote } = state;
  // If some lines are short on stock, the only way forward is an explicit short-confirm (A12).
  const view: QuoteSummary = quote.shortConfirm ?? quote;
  const needsShortConfirm = quote.shortConfirm !== null;
  const nothingOrderable = view.lines.length === 0;

  async function place(shortagePolicy: "REJECT" | "SHORT_CONFIRM") {
    setPlacing(true);
    setPlaceError(null);
    try {
      const res = await fetch("/api/retailer/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines: cart.items, clientRequestId: requestId.current, shortagePolicy }),
      });
      if (res.status === 401 || res.status === 403) {
        setPlaceError({ kind: "message", text: m.common.sessionExpired });
        return setPlacing(false);
      }
      const data = (await res.json().catch(() => null)) as CreateOrderResult | null;
      if (!data) throw new Error("bad response");
      if (data.ok) {
        cart.clear();
        router.push(`/retailer/orders/${data.orderId}?placed=1`);
        return; // keep "placing" state until navigation
      }
      // Nothing was written; a fresh id for the next attempt.
      requestId.current = newRequestId();
      if (data.code === "STOCK_CONFLICT") setPlaceError({ kind: "stock", issues: data.issues });
      else if (data.code === "NOTHING_ORDERABLE") setPlaceError({ kind: "message", text: m.checkout.nothingOrderable });
      else if (data.code === "UNKNOWN_SKU") {
        cart.removeMany(data.skuIds);
        setPlaceError({ kind: "message", text: m.checkout.unknownSku });
      } else setPlaceError({ kind: "message", text: m.checkout.stockChanged });
      refresh();
      setPlacing(false);
    } catch {
      setPlaceError({ kind: "message", text: m.common.networkError });
      setPlacing(false);
    }
  }

  return (
    <div>
      <section className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
        <h2 className="mb-2 font-semibold">{m.checkout.items}</h2>
        <ul className="divide-y divide-slate-100">
          {view.lines.map((l) => (
            <li key={l.skuId} className="py-2">
              <div className="flex justify-between gap-2">
                <span className="min-w-0">
                  <span className="font-medium">{l.name}</span>
                  <span className="block text-xs text-slate-600">
                    {plural(l.qtyCases, m.common.caseOne, m.common.caseMany)} × {formatINR(l.unitPricePaise)}{" "}
                    {fmt(m.common.perCaseOf, { n: l.caseSize })} · {fmt(m.cart.gstAt, { r: l.gstRatePercent })}
                  </span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums">{formatINR(l.totalPaise)}</span>
              </div>
              <div className="mt-1">
                <SchemeChips line={l} m={m} />
              </div>
            </li>
          ))}
        </ul>
      </section>

      {needsShortConfirm && (
        <StockPanel
          m={m}
          issues={quote.lines
            .filter((l) => !l.orderable)
            .map((l) => ({ skuId: l.skuId, skuCode: l.skuCode, name: l.name, requestedCases: l.qtyCases, availableCases: l.maxOrderableCases, reason: l.reason ?? "" }))}
        />
      )}

      {!nothingOrderable && (
        <>
          {needsShortConfirm && <p className="mt-4 text-sm font-medium text-slate-700">{m.checkout.afterShort}</p>}
          <TotalsCard totals={view.totals} m={m} />
          <CreditPanel credit={view.credit} m={m} />
        </>
      )}

      {placeError?.kind === "stock" && <StockPanel m={m} issues={placeError.issues} />}
      {placeError?.kind === "message" && (
        <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          {placeError.text}
        </p>
      )}

      <div className="mt-4 flex flex-col gap-2">
        {nothingOrderable ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{m.checkout.nothingOrderable}</p>
        ) : (
          <button
            type="button"
            disabled={placing}
            onClick={() => place(needsShortConfirm || placeError?.kind === "stock" ? "SHORT_CONFIRM" : "REJECT")}
            className={`min-h-12 rounded-md text-base font-semibold text-white disabled:opacity-60 ${
              view.credit.decision === "ON_HOLD" ? "bg-amber-600 active:bg-amber-700" : "bg-brand-600 active:bg-brand-700"
            }`}
          >
            {placing
              ? m.checkout.placing
              : needsShortConfirm || placeError?.kind === "stock"
                ? m.checkout.acceptShort
                : view.credit.decision === "ON_HOLD"
                  ? m.checkout.placeHold
                  : m.checkout.place}
          </button>
        )}
        <Link href="/retailer/cart" className="flex min-h-12 items-center justify-center rounded-md border border-slate-300 font-semibold text-slate-800">
          {m.checkout.editCart}
        </Link>
      </div>
    </div>
  );
}

function StockPanel({ m, issues }: { m: CheckoutMessages; issues: StockIssue[] }) {
  return (
    <section role="alert" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3">
      <h2 className="font-semibold text-amber-900">{m.checkout.stockTitle}</h2>
      <p className="mt-1 text-sm text-amber-800">{m.checkout.stockBody}</p>
      <ul className="mt-2 space-y-1 text-sm text-amber-900">
        {issues.map((i) => (
          <li key={i.skuId}>
            •{" "}
            {fmt(m.checkout.stockLine, {
              name: i.name,
              req: plural(i.requestedCases, m.common.caseOne, m.common.caseMany),
              avail: plural(i.availableCases, m.common.caseOne, m.common.caseMany),
            })}
          </li>
        ))}
      </ul>
    </section>
  );
}

function CreditPanel({ credit, m }: { credit: CreditPreview; m: CheckoutMessages }) {
  const over = credit.decision === "ON_HOLD";
  const row = "flex justify-between gap-2";
  return (
    <section className={`mt-4 rounded-xl p-4 ring-1 ${over ? "bg-amber-50 ring-amber-300" : "bg-white ring-slate-200"}`}>
      <h2 className="mb-2 font-semibold">{m.checkout.creditImpact}</h2>
      <dl className="space-y-1 text-sm tabular-nums">
        <div className={row}>
          <dt className="text-slate-600">{m.checkout.currentUsed}</dt>
          <dd>{formatINR(credit.usedPaise)}</dd>
        </div>
        <div className={row}>
          <dt className="text-slate-600">{m.checkout.availableNow}</dt>
          <dd>{formatINR(credit.availablePaise)}</dd>
        </div>
        <div className={row}>
          <dt className="text-slate-600">{m.checkout.thisOrder}</dt>
          <dd>{formatINR(credit.orderTotalPaise)}</dd>
        </div>
        <div className={`${row} border-t border-slate-200 pt-1 font-semibold`}>
          <dt>{m.checkout.remainingAfter}</dt>
          <dd>{formatINR(credit.remainingAfterPaise)}</dd>
        </div>
      </dl>
      <p className={`mt-3 rounded-md px-3 py-2 text-sm font-medium ${over ? "bg-amber-100 text-amber-900" : "bg-emerald-50 text-emerald-800"}`}>
        {over ? fmt(m.checkout.overLimit, { x: formatINR(credit.shortfallPaise) }) : m.checkout.withinLimit}
      </p>
    </section>
  );
}
