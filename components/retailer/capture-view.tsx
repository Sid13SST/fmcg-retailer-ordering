"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import type { CaptureView as CaptureData, SkuOption } from "@/lib/capture/service";
import type { ConfirmResult } from "@/lib/capture/service";
import type { StockIssue } from "@/lib/orders/create-order";
import type { QuoteSummary } from "@/lib/orders/quote";
import { newRequestId, useQuote } from "@/lib/cart/use-quote";
import { fmt } from "@/lib/i18n-format";
import {
  CaptureLineCard,
  effectiveCases,
  initialDecision,
  isResolved,
  type CaptureMessages,
  type LineDecision,
} from "./capture-line-card";
import { CreditPanel, StockPanel } from "./checkout-view";
import { TotalsCard } from "./totals-card";

type Phase =
  | { kind: "input" }
  | { kind: "reading" }
  | { kind: "failed"; message: string; engineLabel: string }
  | { kind: "review"; capture: CaptureData };

type PlaceError = { kind: "stock"; issues: StockIssue[] } | { kind: "message"; text: string };

export function CaptureView({
  m,
  sampleMessage,
  plannedEngineLabel,
}: {
  m: CaptureMessages;
  sampleMessage: string;
  /** What will read the message, decided on the server from env config. */
  plannedEngineLabel: string;
}) {
  const c = m.capture;
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "input" });
  const [inputError, setInputError] = useState<string | null>(null);

  async function read(engine: "auto" | "offline") {
    setInputError(null);
    setPhase({ kind: "reading" });
    try {
      const res = await fetch("/api/retailer/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, engine }),
      });
      if (res.status === 401 || res.status === 403) {
        setInputError(m.common.sessionExpired);
        return setPhase({ kind: "input" });
      }
      const data = (await res.json().catch(() => null)) as (CaptureData & { code?: string; message?: string; engineLabel: string }) | null;
      if (res.status === 502 && data) return setPhase({ kind: "failed", message: data.message ?? "", engineLabel: data.engineLabel });
      if (!res.ok || !data) {
        setInputError(res.status === 400 ? c.placeholder : `${m.common.errorTitle}. ${m.common.errorBody}`);
        return setPhase({ kind: "input" });
      }
      setPhase({ kind: "review", capture: data });
    } catch {
      setInputError(m.common.networkError);
      setPhase({ kind: "input" });
    }
  }

  if (phase.kind === "review") {
    return <Review key={phase.capture.captureId} capture={phase.capture} m={m} onStartOver={() => setPhase({ kind: "input" })} />;
  }

  return (
    <div>
      <p className="text-sm text-slate-700">{c.intro}</p>
      <EngineBadge label={plannedEngineLabel} prefix={c.willUse} hint={c.engineHint} />

      <form
        className="mt-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim().length >= 2) void read("auto");
        }}
      >
        <label htmlFor="capture-text" className="text-sm font-semibold">
          {c.inputLabel}
        </label>
        <textarea
          id="capture-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          maxLength={2000}
          placeholder={c.placeholder}
          className="mt-1 w-full rounded-md border border-slate-300 p-3 text-base"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setText(sampleMessage)}
            className="min-h-11 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800"
          >
            {c.useSample}
          </button>
          <button
            type="submit"
            disabled={phase.kind === "reading" || text.trim().length < 2}
            className="min-h-11 flex-1 rounded-md bg-brand-600 px-4 font-semibold text-white disabled:opacity-60"
          >
            {phase.kind === "reading" ? c.reading : c.read}
          </button>
        </div>
      </form>

      {inputError && (
        <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          {inputError}
        </p>
      )}

      {phase.kind === "failed" && (
        <section role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3">
          <h2 className="font-semibold text-red-800">{c.failedTitle}</h2>
          <p className="mt-1 text-sm text-red-800">{c.failedBody}</p>
          <p className="mt-1 text-xs text-red-700">
            {phase.engineLabel}: {phase.message}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => read("auto")} className="min-h-11 rounded-md bg-white px-4 text-sm font-semibold ring-1 ring-red-300">
              {c.tryAgain}
            </button>
            <button type="button" onClick={() => read("offline")} className="min-h-11 rounded-md bg-red-700 px-4 text-sm font-semibold text-white">
              {c.useOffline}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function EngineBadge({ label, prefix, hint }: { label: string; prefix: string; hint: string }) {
  const ai = label.startsWith("AI");
  return (
    <p className="mt-2 text-xs text-slate-600" title={hint}>
      {prefix}:{" "}
      <span
        className={`inline-flex items-center rounded-full px-2 py-0.5 font-semibold ring-1 ${
          ai ? "bg-violet-50 text-violet-800 ring-violet-200" : "bg-slate-100 text-slate-700 ring-slate-300"
        }`}
      >
        {ai ? "✨ " : "⚙ "}
        {label}
      </span>
    </p>
  );
}

function Review({ capture, m, onStartOver }: { capture: CaptureData; m: CaptureMessages; onStartOver: () => void }) {
  const c = m.capture;
  const router = useRouter();
  const [decisions, setDecisions] = useState<Record<string, LineDecision>>(() =>
    Object.fromEntries(capture.lines.map((l) => [l.id, initialDecision(l)])),
  );
  const [skus, setSkus] = useState<Record<string, SkuOption>>(capture.skus);
  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState<PlaceError | null>(null);
  const requestId = useRef(newRequestId());

  const lines = capture.lines;
  const skuOf = (id: string | null) => (id ? skus[id] : undefined);
  const pending = lines.filter((l) => !isResolved(l, decisions[l.id]!, skuOf(decisions[l.id]!.skuId))).length;
  const active = lines.filter((l) => !decisions[l.id]!.removed);

  // Price only once every line is answered, so totals never reflect a guess.
  const items = useMemo(
    () =>
      pending > 0
        ? []
        : active.map((l) => ({ skuId: decisions[l.id]!.skuId!, qtyCases: effectiveCases(l, decisions[l.id]!, skuOf(decisions[l.id]!.skuId))! })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- derived from decisions/skus
    [decisions, skus, pending],
  );
  const { state: quoteState, refresh } = useQuote(items, 300);
  const quote = quoteState.kind === "ready" ? quoteState.quote : null;
  const view: QuoteSummary | null = quote ? (quote.shortConfirm ?? quote) : null;
  const needsShort = !!quote?.shortConfirm || placeError?.kind === "stock";

  async function confirm() {
    setPlacing(true);
    setPlaceError(null);
    try {
      const res = await fetch(`/api/retailer/capture/${capture.captureId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientRequestId: requestId.current,
          shortagePolicy: needsShort ? "SHORT_CONFIRM" : "REJECT",
          lines: active.map((l) => {
            const d = decisions[l.id]!;
            return {
              lineId: l.id,
              skuId: d.skuId,
              qtyCases: effectiveCases(l, d, skuOf(d.skuId)),
              ...(l.needsUnitChoice ? { unitChoice: d.unitChoice } : {}),
            };
          }),
          removedLineIds: lines.filter((l) => decisions[l.id]!.removed).map((l) => l.id),
        }),
      });
      if (res.status === 401 || res.status === 403) {
        setPlaceError({ kind: "message", text: m.common.sessionExpired });
        return setPlacing(false);
      }
      const data = (await res.json().catch(() => null)) as ConfirmResult | null;
      if (!data || res.status >= 500) {
        setPlaceError({ kind: "message", text: `${m.common.errorTitle}. ${m.common.errorBody}` });
        return setPlacing(false);
      }
      if (data.ok) {
        router.push(`/retailer/orders/${data.orderId}?placed=1`);
        return;
      }
      requestId.current = newRequestId();
      if (data.code === "STOCK_CONFLICT") setPlaceError({ kind: "stock", issues: data.issues });
      else if (data.code === "NOTHING_ORDERABLE") setPlaceError({ kind: "message", text: m.checkout.nothingOrderable });
      else if (data.code === "CAPTURE_CLOSED" || data.code === "CAPTURE_NOT_FOUND") setPlaceError({ kind: "message", text: c.closed });
      else if (data.code === "INCOMPLETE_REVIEW") setPlaceError({ kind: "message", text: c.incomplete });
      else if (data.code === "UNKNOWN_SKU") setPlaceError({ kind: "message", text: m.checkout.unknownSku });
      else setPlaceError({ kind: "message", text: m.checkout.stockChanged });
      refresh();
      setPlacing(false);
    } catch {
      setPlaceError({ kind: "message", text: m.common.networkError });
      setPlacing(false);
    }
  }

  async function discard() {
    await fetch(`/api/retailer/capture/${capture.captureId}/discard`, { method: "POST" }).catch(() => null);
    onStartOver();
  }

  const onHold = view?.credit.decision === "ON_HOLD";

  return (
    <div>
      <EngineBadge label={capture.engineLabel} prefix={c.engine} hint={c.engineHint} />
      <figure className="mt-2 rounded-xl bg-white p-3 ring-1 ring-slate-200">
        <figcaption className="text-xs font-semibold text-slate-500">{c.yourMessage}</figcaption>
        <blockquote className="mt-1 whitespace-pre-wrap text-sm text-slate-900">{capture.rawText}</blockquote>
      </figure>

      <ul className="mt-3 space-y-3">
        {lines.map((l, i) => (
          <CaptureLineCard
            key={l.id}
            line={l}
            index={i}
            total={lines.length}
            decision={decisions[l.id]!}
            skus={skus}
            m={m}
            onChange={(d) => {
              setPlaceError(null);
              setDecisions((prev) => ({ ...prev, [l.id]: d }));
            }}
            onPickSku={(s) => setSkus((prev) => ({ ...prev, [s.id]: s }))}
          />
        ))}
      </ul>

      <section className="mt-4">
        {active.length === 0 ? (
          <p className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">{c.nothingLeft}</p>
        ) : pending > 0 ? (
          <p role="status" className="rounded-md bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 ring-1 ring-amber-300">
            ❓ {fmt(c.pending, { n: pending })}
          </p>
        ) : (
          <>
            <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
              ✓ {c.allSet}
            </p>
            {quote?.shortConfirm && (
              <StockPanel
                m={m}
                issues={quote.lines
                  .filter((l) => !l.orderable)
                  .map((l) => ({ skuId: l.skuId, skuCode: l.skuCode, name: l.name, requestedCases: l.qtyCases, availableCases: l.maxOrderableCases, reason: l.reason ?? "" }))}
              />
            )}
            {view && view.lines.length > 0 && (
              <>
                {quote?.shortConfirm && <p className="mt-4 text-sm font-medium text-slate-700">{m.checkout.afterShort}</p>}
                <TotalsCard totals={view.totals} m={m} />
                <CreditPanel credit={view.credit} m={m} />
              </>
            )}
            {quoteState.kind === "loading" && <p className="mt-3 text-sm text-slate-500">{m.common.loading}</p>}
          </>
        )}

        {placeError?.kind === "stock" && <StockPanel m={m} issues={placeError.issues} />}
        {placeError?.kind === "message" && (
          <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
            {placeError.text}
          </p>
        )}

        <div className="mt-4 flex flex-col gap-2">
          {/* Hard rule: nothing is ordered until a person confirms every line here. */}
          <button
            type="button"
            disabled={placing || pending > 0 || active.length === 0 || !view || view.lines.length === 0}
            onClick={confirm}
            className={`min-h-12 rounded-md text-base font-semibold text-white disabled:opacity-50 ${
              onHold ? "bg-amber-600 active:bg-amber-700" : "bg-brand-600 active:bg-brand-700"
            }`}
          >
            {placing ? c.confirming : needsShort ? m.checkout.acceptShort : onHold ? c.confirmHold : c.confirm}
          </button>
          <button type="button" onClick={discard} className="min-h-12 rounded-md border border-slate-300 font-semibold text-slate-800">
            {c.startOver}
          </button>
        </div>
      </section>
    </div>
  );
}
