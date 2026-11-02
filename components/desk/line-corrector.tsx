"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { formatINR } from "@/lib/money";

interface SkuHit {
  id: string;
  code: string;
  name: string;
  caseSize: number;
  stockCases: number;
  dealerPricePerCasePaise: number;
}

export function LineCorrector({
  orderId,
  retailerId,
  line,
  isAiLine,
}: {
  orderId: string;
  retailerId: string;
  line: { id: string; skuId: string; skuCode: string; skuName: string; qtyCases: number };
  isAiLine: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SkuHit[]>([]);
  const [searchError, setSearchError] = useState(false);
  const [sku, setSku] = useState<{ id: string; code: string; name: string }>({ id: line.skuId, code: line.skuCode, name: line.skuName });
  const [qty, setQty] = useState(line.qtyCases);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || q.trim().length < 2) {
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/desk/sku-search?q=${encodeURIComponent(q)}&retailerId=${encodeURIComponent(retailerId)}`, { signal: ctrl.signal })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((d: { skus?: SkuHit[] }) => {
          setSearchError(false);
          setHits(d.skus ?? []);
        })
        .catch((err: Error) => {
          if (err.name !== "AbortError") setSearchError(true);
        });
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, open, retailerId]);

  const changed = sku.id !== line.skuId || qty !== line.qtyCases;

  async function save() {
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = {};
    if (sku.id !== line.skuId) body.skuId = sku.id;
    if (qty !== line.qtyCases) body.qtyCases = qty;
    if (reason.trim()) body.reason = reason.trim();
    try {
      const res = await fetch(`/api/desk/orders/${orderId}/lines/${line.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        setError(data.message ?? "Could not save the correction.");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="min-h-9 rounded-md border border-slate-300 px-3 text-xs font-medium text-slate-700 hover:bg-slate-100">
        Correct
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-2 rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
      <div>
        <label className="block text-xs font-medium text-slate-600" htmlFor={`sku-${line.id}`}>
          SKU: <span className="font-semibold text-slate-900">{sku.name} ({sku.code})</span>
        </label>
        <input
          id={`sku-${line.id}`}
          type="search"
          placeholder="Search to swap SKU (name, code, brand)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
        {searchError && <p role="alert" className="mt-1 text-xs text-red-700">SKU search failed. Check the connection and type again.</p>}
        {!searchError && q.trim().length >= 2 && hits.length === 0 && <p className="mt-1 text-xs text-slate-500">No matching SKU.</p>}
        {hits.length > 0 && (
          <ul className="mt-1 max-h-48 overflow-y-auto rounded-md bg-white ring-1 ring-slate-200">
            {hits.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSku({ id: h.id, code: h.code, name: h.name });
                    setQ("");
                  }}
                  className="flex w-full justify-between gap-2 px-2 py-1.5 text-left text-sm hover:bg-brand-50"
                >
                  <span>
                    {h.name} <span className="text-xs text-slate-500">({h.code}, case of {h.caseSize})</span>
                  </span>
                  <span className="shrink-0 text-xs text-slate-500">
                    {formatINR(h.dealerPricePerCasePaise)} · {h.stockCases} in stock
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-slate-600">
          Cases
          <input
            type="number"
            min={1}
            max={9999}
            value={qty}
            onChange={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            className="mt-1 block w-24 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="min-w-0 flex-1 text-xs font-medium text-slate-600">
          Note (optional)
          <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
        </label>
      </div>
      {isAiLine && sku.id !== line.skuId && (
        <p className="text-xs text-sky-800">Saving teaches this retailer&apos;s words → {sku.code} for future text orders.</p>
      )}
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={!changed || busy} onClick={save} className="min-h-9 rounded-md bg-slate-900 px-3 text-xs font-semibold text-white disabled:opacity-50">
          {busy ? "Saving…" : "Save correction"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setSku({ id: line.skuId, code: line.skuCode, name: line.skuName });
            setQty(line.qtyCases);
            setError(null);
          }}
          className="min-h-9 rounded-md border border-slate-300 px-3 text-xs text-slate-700"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
