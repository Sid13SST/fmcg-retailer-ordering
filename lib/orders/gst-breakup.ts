/** Group order lines by GST rate: taxable value and GST per rate. Pure. */
export interface GstBreakupRow {
  ratePercent: number;
  taxablePaise: number;
  gstPaise: number;
}

export function gstBreakup(lines: ReadonlyArray<{ gstRatePercent: number; subtotalPaise: number; gstPaise: number }>): GstBreakupRow[] {
  const byRate = new Map<number, GstBreakupRow>();
  for (const l of lines) {
    const row = byRate.get(l.gstRatePercent) ?? { ratePercent: l.gstRatePercent, taxablePaise: 0, gstPaise: 0 };
    row.taxablePaise += l.subtotalPaise;
    row.gstPaise += l.gstPaise;
    byRate.set(l.gstRatePercent, row);
  }
  return [...byRate.values()].sort((a, b) => a.ratePercent - b.ratePercent);
}
