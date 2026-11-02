"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { formatINR } from "@/lib/money";
import type { DeskAction } from "@/lib/desk/transitions";
import { downloadCsv } from "./download";

type Mode = null | "HOLD" | "REJECT";

async function post(url: string, body: unknown) {
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as { code?: string; message?: string; shortfallPaise?: number };
    return { ok: res.ok, ...data };
  } catch {
    return { ok: false, message: "Network error. Check the connection and try again." } as { ok: false; message: string; code?: string; shortfallPaise?: number };
  }
}

export function OrderActions({
  orderId,
  orderNumber,
  actions,
  shortfallPaise,
  hasExport,
}: {
  orderId: string;
  orderNumber: string;
  actions: DeskAction[];
  /** Shortfall if approved now (0 = within limit). */
  shortfallPaise: number;
  hasExport: boolean;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [confirmPaise, setConfirmPaise] = useState(shortfallPaise);
  const [mode, setMode] = useState<Mode>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const base = `/api/desk/orders/${orderId}`;

  async function approve(confirmShortfallPaise?: number) {
    setBusy(true);
    setError(null);
    const res = await post(`${base}/approve`, confirmShortfallPaise === undefined ? {} : { confirmShortfallPaise });
    setBusy(false);
    if (res.ok) {
      dialog.current?.close();
      setNotice(`${orderNumber} approved.`);
      router.refresh();
      return;
    }
    if (res.code === "CREDIT_CONFIRM_REQUIRED" && typeof res.shortfallPaise === "number") {
      // Show (or re-show with the fresh amount) the explicit confirmation.
      setConfirmPaise(res.shortfallPaise);
      dialog.current?.showModal();
      return;
    }
    dialog.current?.close();
    setError(res.message ?? "Could not approve.");
  }

  function onApproveClick() {
    if (shortfallPaise > 0) {
      setConfirmPaise(shortfallPaise);
      dialog.current?.showModal();
    } else {
      void approve();
    }
  }

  async function submitReason() {
    if (!mode) return;
    setBusy(true);
    setError(null);
    const res = await post(`${base}/${mode === "HOLD" ? "hold" : "reject"}`, { reason });
    setBusy(false);
    if (!res.ok) return setError(res.message ?? "Action failed.");
    setNotice(mode === "HOLD" ? `${orderNumber} put on hold.` : `${orderNumber} rejected; stock returned.`);
    setMode(null);
    setReason("");
    router.refresh();
  }

  async function exportCsv(again: boolean) {
    setBusy(true);
    setError(null);
    const res = await downloadCsv(`${base}/export`, again ? "GET" : "POST");
    setBusy(false);
    if (!res.ok) return setError(res.message);
    if (!again) setNotice(`${orderNumber} exported to Tally (CSV downloaded).`);
    router.refresh();
  }

  const btn = "min-h-11 rounded-md px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <section aria-label="Desk actions" className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-base font-semibold">Actions</h2>
      <div className="flex flex-wrap gap-2">
        {actions.includes("APPROVE") && (
          <button type="button" disabled={busy} onClick={onApproveClick} className="btn btn-primary">
            Approve{shortfallPaise > 0 ? " over limit…" : ""}
          </button>
        )}
        {actions.includes("HOLD") && (
          <button type="button" disabled={busy} onClick={() => setMode("HOLD")} className={`${btn} border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100`}>
            Put on hold
          </button>
        )}
        {actions.includes("REJECT") && (
          <button type="button" disabled={busy} onClick={() => setMode("REJECT")} className={`${btn} border border-red-300 bg-white text-red-700 hover:bg-red-50`}>
            Reject…
          </button>
        )}
        {actions.includes("EXPORT") && (
          <button type="button" disabled={busy} onClick={() => exportCsv(false)} className="btn btn-dark">
            Export to Tally
          </button>
        )}
        {hasExport && (
          <button type="button" disabled={busy} onClick={() => exportCsv(true)} className="btn btn-secondary">
            Download Tally CSV again
          </button>
        )}
        {actions.length === 0 && !hasExport && <p className="text-sm text-slate-500">No further desk action is possible for this order.</p>}
      </div>

      {mode && (
        <form
          className="mt-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submitReason();
          }}
        >
          <label htmlFor="reason" className="block text-sm font-medium">
            {mode === "HOLD" ? "Why hold this order?" : "Reason for rejection (shown to the retailer)"}
          </label>
          <textarea
            id="reason"
            required
            minLength={3}
            maxLength={500}
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-md border border-slate-300 p-2 text-sm"
          />
          <div className="flex gap-2">
            <button type="submit" disabled={busy || reason.trim().length < 3} className={`${btn} ${mode === "HOLD" ? "bg-amber-600" : "bg-red-600"} text-white`}>
              {mode === "HOLD" ? "Hold order" : "Reject order"}
            </button>
            <button type="button" onClick={() => setMode(null)} className={`${btn} border border-slate-300 text-slate-700`}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200">{error}</p>}
      {notice && !error && <p role="status" className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>}

      <dialog ref={dialog} aria-labelledby="credit-confirm-title" className="w-[min(28rem,calc(100vw-2rem))] rounded-xl p-0 backdrop:bg-slate-900/50">
        <div className="space-y-3 p-5">
          <h3 id="credit-confirm-title" className="text-lg font-semibold text-red-800">Approve over credit limit?</h3>
          <p className="text-sm text-slate-700">
            Retailer will exceed credit limit by <strong className="tabular-nums">{formatINR(confirmPaise)}</strong>.
          </p>
          <p className="text-xs text-slate-500">The full order total is added to the retailer&apos;s used credit. This is recorded in the audit trail with your name.</p>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => dialog.current?.close()} className={`${btn} border border-slate-300 text-slate-700`}>
              Cancel
            </button>
            <button type="button" disabled={busy} onClick={() => approve(confirmPaise)} className={`${btn} bg-red-600 text-white hover:bg-red-700`}>
              Approve anyway
            </button>
          </div>
        </div>
      </dialog>
    </section>
  );
}
