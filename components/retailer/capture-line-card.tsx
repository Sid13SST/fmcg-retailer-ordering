"use client";

import { useEffect, useState } from "react";
import type { CaptureLine } from "@/lib/capture/pipeline";
import type { SkuOption } from "@/lib/capture/service";
import type { Messages } from "@/lib/i18n";
import { fmt, plural } from "@/lib/i18n-format";
import { formatINR } from "@/lib/money";
import { LOW_STOCK_THRESHOLD } from "./badges";
import { QtyStepper } from "./qty-stepper";

export type CaptureMessages = Pick<Messages, "capture" | "common" | "cart" | "catalogue" | "checkout">;

/** What the retailer has decided for one parsed line. */
export interface LineDecision {
  skuId: string | null;
  /** Unit answer for lines where case vs piece was unclear. */
  unitChoice: "CASE" | "PIECES" | null;
  /** Cases the retailer set explicitly (stepper/typed). null = derive from the words. */
  qtyCases: number | null;
  removed: boolean;
}

export function initialDecision(line: CaptureLine): LineDecision {
  return { skuId: line.skuId, unitChoice: line.needsUnitChoice ? null : "CASE", qtyCases: null, removed: false };
}

/** Cases to order for a line, or null while something is still unanswered. */
export function effectiveCases(line: CaptureLine, d: LineDecision, sku: SkuOption | undefined): number | null {
  if (d.qtyCases !== null) return d.qtyCases;
  if (line.qty === null || d.unitChoice === null) return null;
  if (d.unitChoice === "CASE") return line.qty;
  return sku ? Math.max(1, Math.ceil(line.qty / sku.caseSize)) : null;
}

export function isResolved(line: CaptureLine, d: LineDecision, sku: SkuOption | undefined): boolean {
  if (d.removed) return true;
  const cases = effectiveCases(line, d, sku);
  return !!d.skuId && !!sku && d.unitChoice !== null && cases !== null && cases >= 1;
}

const CONF_STYLE = {
  high: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  medium: "bg-amber-50 text-amber-800 ring-amber-300",
  low: "bg-red-50 text-red-700 ring-red-200",
} as const;

export function CaptureLineCard({
  line,
  index,
  total,
  decision,
  skus,
  onChange,
  onPickSku,
  m,
}: {
  line: CaptureLine;
  index: number;
  total: number;
  decision: LineDecision;
  skus: Record<string, SkuOption>;
  onChange: (d: LineDecision) => void;
  onPickSku: (sku: SkuOption) => void;
  m: CaptureMessages;
}) {
  const c = m.capture;
  const [searching, setSearching] = useState(false);
  const sku = decision.skuId ? skus[decision.skuId] : undefined;
  const cases = effectiveCases(line, decision, sku);
  const swapped = decision.skuId !== line.skuId;

  if (decision.removed) {
    return (
      <li className="flex items-center justify-between gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-600">
        <span className="min-w-0 truncate">{fmt(c.removed, { raw: line.rawPhrase })}</span>
        <button type="button" className="min-h-11 shrink-0 px-2 font-semibold text-brand-700" onClick={() => onChange({ ...decision, removed: false })}>
          {c.undo}
        </button>
      </li>
    );
  }

  // Original best + alternatives, minus whatever is selected now: tap to swap.
  const swapIds = [line.skuId, ...line.alternativeSkuIds].filter((id): id is string => !!id && id !== decision.skuId).slice(0, 2);
  const resolved = isResolved(line, decision, sku);

  return (
    <li className={`rounded-xl bg-white p-3 ring-1 ${resolved ? "ring-slate-200" : "ring-amber-300"}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-slate-500">{fmt(c.lineOf, { n: index + 1, total })}</p>
        {line.confidence && !swapped && (
          <span
            title={c.confidenceTip}
            aria-label={`${c.confidence[line.confidence]}. ${c.confidenceTip}`}
            className={`inline-flex shrink-0 cursor-help items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${CONF_STYLE[line.confidence]}`}
          >
            {c.confidence[line.confidence]} ⓘ
          </span>
        )}
      </div>

      {/* Hard rule: the retailer's own words are always visible. */}
      <p className="mt-1 rounded-md bg-slate-100 px-2 py-1 text-sm">
        <span className="text-slate-500">{c.youWrote}: </span>
        <q className="font-medium text-slate-900">{line.rawPhrase}</q>
      </p>

      {line.notes.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs font-medium text-amber-800">
          {line.notes.includes("AI_REWORDED") && <li>⚠ {c.noteReworded}</li>}
          {line.notes.includes("QTY_CHECK") && <li>⚠ {c.noteQty}</li>}
          {line.notes.includes("UNIT_NOT_IN_TEXT") && <li>ⓘ {c.noteUnit}</li>}
        </ul>
      )}

      {sku ? (
        <div className="mt-2 flex items-start gap-3">
          <span aria-hidden className="text-2xl leading-none">
            {sku.imageEmoji ?? "📦"}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{sku.name}</p>
            <p className="text-xs text-slate-600">
              {sku.code} · {sku.brand} · {formatINR(sku.dealerPricePerCasePaise)} {fmt(m.common.perCaseOf, { n: sku.caseSize })} · {m.common.exclGst}
            </p>
            {!swapped && line.learned && (
              <p className="mt-1 text-xs text-sky-800">
                ✨ {fmt(line.learned.source === "CORRECTED" ? c.learnedCorrection : c.learned, { phrase: line.learned.phrase })}
              </p>
            )}
            {!swapped && !line.learned && line.aliasPhrase && line.evidence !== "NAME" && (
              <p className="mt-1 text-xs text-slate-500">{fmt(c.aliasUsed, { phrase: line.aliasPhrase })}</p>
            )}
            {sku.stockCases <= 0 ? (
              <p className="mt-1 rounded-md bg-red-50 px-2 py-1 text-xs font-semibold text-red-700">✕ {c.outOfStock}</p>
            ) : sku.stockCases < LOW_STOCK_THRESHOLD ? (
              <p className="mt-1 text-xs font-medium text-amber-800">! {fmt(c.lowStock, { n: sku.stockCases })}</p>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-2">
          <p className="font-semibold text-red-700">✕ {c.noMatch}</p>
          <p className="text-xs text-red-700">{c.noMatchHint}</p>
        </div>
      )}

      {swapIds.length > 0 && (
        <div className="mt-2">
          <p className="text-xs text-slate-600">{sku ? c.alternatives : c.suggestions}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {swapIds.map((id) => {
              const alt = skus[id];
              if (!alt) return null;
              return (
                <button
                  key={id}
                  type="button"
                  aria-label={fmt(c.swapTo, { name: alt.name })}
                  onClick={() => onChange({ ...decision, skuId: id })}
                  className="min-h-11 rounded-md border border-slate-300 bg-white px-3 text-left text-sm active:bg-slate-100"
                >
                  <span className="font-medium">{alt.name}</span>
                  {alt.stockCases <= 0 && <span className="ml-1 text-xs text-red-700">({m.catalogue.outOfStock})</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {searching ? (
        <SkuSearch
          m={m}
          onCancel={() => setSearching(false)}
          onPick={(s) => {
            onPickSku(s);
            onChange({ ...decision, skuId: s.id });
            setSearching(false);
          }}
          initial={line.productText}
        />
      ) : (
        <button type="button" onClick={() => setSearching(true)} className="mt-2 min-h-11 text-sm font-semibold text-brand-700">
          🔍 {c.search}
        </button>
      )}

      {/* Unit clarification: asked, never guessed. */}
      {line.needsUnitChoice && (
        <UnitQuestion line={line} decision={decision} sku={sku} onChange={onChange} m={m} />
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <div>
          <p className="text-xs font-medium text-slate-600">{line.qty === null && cases === null ? c.qtyMissing : c.qty}</p>
          {cases === null ? (
            <MissingQty onSet={(n) => onChange({ ...decision, qtyCases: n })} label={c.qty} />
          ) : (
            <QtyStepper
              value={cases}
              idSuffix={line.id}
              labels={{ decrease: m.catalogue.decrease, increase: m.catalogue.increase, qtyLabel: c.qty }}
              onChange={(n) => (n <= 0 ? onChange({ ...decision, removed: true }) : onChange({ ...decision, qtyCases: n }))}
            />
          )}
        </div>
        <button type="button" onClick={() => onChange({ ...decision, removed: true })} className="min-h-11 px-2 text-sm font-semibold text-red-700">
          {c.remove}
        </button>
      </div>
    </li>
  );
}

function UnitQuestion({
  line,
  decision,
  sku,
  onChange,
  m,
}: {
  line: CaptureLine;
  decision: LineDecision;
  sku: SkuOption | undefined;
  onChange: (d: LineDecision) => void;
  m: CaptureMessages;
}) {
  const c = m.capture;
  const n = line.qty ?? "";
  const casesLabel = fmt(c.unitCases, { n }).trim();
  const piecesLabel = fmt(c.unitPieces, { n }).trim();
  const question = fmt(line.unit === "PIECE" ? c.unitQuestion : c.unitNoneQuestion, { raw: line.rawPhrase });
  const btn = (active: boolean) =>
    `min-h-11 flex-1 rounded-md border px-3 text-sm font-semibold ${active ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white text-slate-800"}`;
  return (
    <fieldset className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-2">
      <legend className="px-1 text-sm font-semibold text-amber-900">❓ {question}</legend>
      <div className="flex gap-2">
        <button
          type="button"
          aria-pressed={decision.unitChoice === "CASE"}
          className={btn(decision.unitChoice === "CASE")}
          onClick={() => onChange({ ...decision, unitChoice: "CASE", qtyCases: null })}
        >
          {casesLabel}
        </button>
        <button
          type="button"
          aria-pressed={decision.unitChoice === "PIECES"}
          className={btn(decision.unitChoice === "PIECES")}
          onClick={() => onChange({ ...decision, unitChoice: "PIECES", qtyCases: null })}
        >
          {piecesLabel}
        </button>
      </div>
      {decision.unitChoice === "PIECES" && sku && line.qty !== null && (
        <p className="mt-2 text-xs text-amber-900">
          {fmt(c.piecesNote, {
            size: sku.caseSize,
            pieces: line.qty,
            cases: plural(Math.max(1, Math.ceil(line.qty / sku.caseSize)), m.common.caseOne, m.common.caseMany),
          })}
        </p>
      )}
    </fieldset>
  );
}

function MissingQty({ onSet, label }: { onSet: (n: number) => void; label: string }) {
  const [text, setText] = useState("");
  const commit = () => {
    const n = Number.parseInt(text, 10);
    if (n >= 1) onSet(Math.min(9999, n));
  };
  return (
    <input
      aria-label={label}
      inputMode="numeric"
      pattern="[0-9]*"
      placeholder="?"
      value={text}
      onChange={(e) => setText(e.target.value.replace(/\D/g, "").slice(0, 4))}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
      className="h-11 w-20 rounded-md border-2 border-amber-400 text-center text-base font-semibold tabular-nums"
    />
  );
}

function SkuSearch({
  m,
  onPick,
  onCancel,
  initial,
}: {
  m: CaptureMessages;
  onPick: (s: SkuOption) => void;
  onCancel: () => void;
  initial: string;
}) {
  const c = m.capture;
  const [q, setQ] = useState(initial.split(" ")[0] ?? "");
  const [state, setState] = useState<{ loading: boolean; results: SkuOption[] | null; failed?: boolean }>({ loading: false, results: null });

  useEffect(() => {
    const term = q.trim();
    if (!term) return setState({ loading: false, results: null });
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true }));
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/retailer/sku-search?q=${encodeURIComponent(term)}`, { signal: controller.signal });
        if (!res.ok) return setState({ loading: false, results: null, failed: true });
        const data = (await res.json()) as { results?: SkuOption[] };
        setState({ loading: false, results: data.results ?? [] });
      } catch (err) {
        if ((err as Error).name !== "AbortError") setState({ loading: false, results: null, failed: true });
      }
    }, 250);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [q]);

  return (
    <div className="mt-2 rounded-md border border-slate-300 p-2">
      <div className="flex gap-2">
        <input
          autoFocus
          type="search"
          aria-label={c.search}
          placeholder={c.searchPlaceholder}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-11 min-w-0 flex-1 rounded-md border border-slate-300 px-3 text-base"
        />
        <button type="button" onClick={onCancel} className="min-h-11 px-2 text-sm font-semibold text-slate-700">
          {c.cancel}
        </button>
      </div>
      {state.loading && <p className="mt-2 text-xs text-slate-500">{c.searching}</p>}
      {state.failed && !state.loading && (
        <p role="alert" className="mt-2 text-xs font-medium text-red-700">
          {m.common.networkError}
        </p>
      )}
      {state.results && state.results.length === 0 && !state.loading && <p className="mt-2 text-xs text-slate-600">{c.noResults}</p>}
      {state.results && state.results.length > 0 && (
        <ul className="mt-2 divide-y divide-slate-100">
          {state.results.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => onPick(s)} className="flex min-h-11 w-full items-center justify-between gap-2 py-1 text-left">
                <span className="min-w-0">
                  <span className="text-sm font-medium">
                    {s.imageEmoji} {s.name}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {s.code} · {fmt(m.common.perCaseOf, { n: s.caseSize })}
                    {s.stockCases <= 0 ? ` · ${m.catalogue.outOfStock}` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-semibold text-brand-700">{c.pick}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
