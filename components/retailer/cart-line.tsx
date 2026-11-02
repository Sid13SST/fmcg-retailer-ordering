import type { QuotedLine } from "@/lib/orders/quote";
import type { Messages } from "@/lib/i18n";
import { fmt, plural } from "@/lib/i18n-format";
import { formatINR } from "@/lib/money";

export type CartLineMessages = Pick<Messages, "cart" | "common" | "catalogue">;

/** Localized "add N more" nudge from the line's scheme (null if earned/none). */
export function schemeNudge(line: QuotedLine, m: CartLineMessages): string | null {
  const s = line.scheme;
  if (!s || !s.active || line.qtyCases === 0) return null;
  if (s.type === "BUY_X_GET_Y_FREE") {
    const rem = line.qtyCases % s.thresholdCases;
    return rem === 0 ? null : fmt(m.cart.hintFree, { n: s.thresholdCases - rem, y: s.freeCases });
  }
  return line.qtyCases >= s.thresholdCases ? null : fmt(m.cart.hintSlab, { n: s.thresholdCases - line.qtyCases, p: s.percentOff });
}

export function unavailableText(line: QuotedLine, m: CartLineMessages): string {
  if (line.reasonCode === "OUT_OF_STOCK") return m.catalogue.outOfStock;
  return fmt(m.cart.onlyAvailable, { n: plural(line.maxOrderableCases, m.common.caseOne, m.common.caseMany) });
}

/** Scheme outcome chips: "+1 case FREE", "3% slab applied". */
export function SchemeChips({ line, m }: { line: QuotedLine; m: CartLineMessages }) {
  const nudge = line.orderable ? schemeNudge(line, m) : null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {line.freeCases > 0 && (
        <span className="rounded-md bg-emerald-600 px-2 py-0.5 text-xs font-bold text-white">
          {plural(line.freeCases, m.cart.freeOne, m.cart.freeMany)}
        </span>
      )}
      {line.discountPercent > 0 && (
        <span className="rounded-md bg-emerald-600 px-2 py-0.5 text-xs font-bold text-white">
          {fmt(m.cart.slabApplied, { p: line.discountPercent })}
        </span>
      )}
      {nudge && <span className="rounded-md bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">💡 {nudge}</span>}
    </div>
  );
}

/** Money breakdown for one line, all in paise formatted at the edge. */
export function LineMoney({ line, m }: { line: QuotedLine; m: CartLineMessages }) {
  const row = "flex justify-between gap-2";
  return (
    <dl className="space-y-0.5 text-sm tabular-nums">
      <div className={row}>
        <dt className="text-slate-600">
          {m.cart.gross} ({line.qtyCases} × {formatINR(line.unitPricePaise)})
        </dt>
        <dd>{formatINR(line.grossPaise)}</dd>
      </div>
      {line.discountPaise > 0 && (
        <div className={`${row} text-emerald-700`}>
          <dt>{m.cart.discount}</dt>
          <dd>−{formatINR(line.discountPaise)}</dd>
        </div>
      )}
      <div className={row}>
        <dt className="text-slate-600">{m.cart.subtotal}</dt>
        <dd>{formatINR(line.subtotalPaise)}</dd>
      </div>
      <div className={row}>
        <dt className="text-slate-600">{fmt(m.cart.gstAt, { r: line.gstRatePercent })}</dt>
        <dd>{formatINR(line.gstPaise)}</dd>
      </div>
      <div className={`${row} font-semibold`}>
        <dt>{m.cart.lineTotal}</dt>
        <dd>{formatINR(line.totalPaise)}</dd>
      </div>
    </dl>
  );
}
