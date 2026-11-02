"use client";

import { useEffect, useState } from "react";

export interface QtyLabels {
  decrease: string;
  increase: string;
  qtyLabel: string;
}

/** Large-tap stepper with a typeable number field. 0 means "remove". */
export function QtyStepper({
  value,
  onChange,
  labels,
  max = 9999,
  idSuffix,
}: {
  value: number;
  onChange: (qty: number) => void;
  labels: QtyLabels;
  max?: number;
  idSuffix: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);

  const commit = (raw: string) => {
    const n = Number.parseInt(raw, 10);
    if (Number.isNaN(n)) return setText(String(value));
    onChange(Math.max(0, Math.min(max, n)));
  };

  const btn =
    "flex h-11 w-11 items-center justify-center rounded-md border border-slate-300 bg-white text-xl font-semibold text-slate-800 active:bg-slate-100";
  return (
    <div className="flex items-center gap-1">
      <button type="button" className={btn} aria-label={labels.decrease} onClick={() => onChange(value - 1)}>
        −
      </button>
      <label htmlFor={`qty-${idSuffix}`} className="sr-only">
        {labels.qtyLabel}
      </label>
      <input
        id={`qty-${idSuffix}`}
        inputMode="numeric"
        pattern="[0-9]*"
        value={text}
        onChange={(e) => setText(e.target.value.replace(/\D/g, "").slice(0, 4))}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && commit((e.target as HTMLInputElement).value)}
        className="h-11 w-14 rounded-md border border-slate-300 text-center text-base font-semibold tabular-nums"
      />
      <button
        type="button"
        className={btn}
        aria-label={labels.increase}
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
      >
        +
      </button>
    </div>
  );
}
