"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { downloadCsv } from "./download";

export function BulkExportButton({ count }: { count: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function run() {
    setBusy(true);
    setMessage(null);
    const res = await downloadCsv("/api/desk/exports/today");
    setBusy(false);
    setMessage(res.ok ? { ok: true, text: `Exported ${count} order${count === 1 ? "" : "s"} to one CSV.` } : { ok: false, text: res.message });
    router.refresh();
  }

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <button
        type="button"
        onClick={run}
        disabled={busy || count === 0}
        className="btn btn-dark"
      >
        {busy ? "Exporting…" : `Export today's approved (${count})`}
      </button>
      {message && (
        <p role="status" className={`text-xs ${message.ok ? "text-emerald-700" : "text-red-700"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
