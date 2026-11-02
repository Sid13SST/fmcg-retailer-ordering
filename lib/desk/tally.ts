/**
 * Mocked Tally export (A8): a CSV with Tally-style columns, one row per order line
 * plus a zero-value row for scheme free goods. Pure; amounts come from paise and are
 * written as rupees with exactly two decimals (no float math).
 */
import { paiseToRupeeString } from "@/lib/money";
import { istDateDDMMYYYY } from "./ist";

export const TALLY_COLUMNS = [
  "Voucher Type",
  "Voucher No",
  "Date",
  "Debtor/Retailer",
  "Item",
  "Qty",
  "Rate",
  "Discount",
  "Amount",
  "GST",
  "Ledger",
] as const;

export const TALLY_VOUCHER_TYPE = "Sales Order";

export interface TallyOrderInput {
  orderNumber: string;
  createdAt: Date;
  retailer: { shopName: string; area: string };
  lines: Array<{
    skuCode: string;
    skuName: string;
    caseSize: number;
    qtyCases: number;
    freeCases: number;
    unitPricePaise: number;
    discountPaise: number;
    subtotalPaise: number;
    gstPaise: number;
    gstRatePercent: number;
    schemeLabel: string | null;
  }>;
}

export type TallyRow = Record<(typeof TALLY_COLUMNS)[number], string>;

/** Sales ledger per GST rate; GST rates are demo values (A13). */
export function salesLedger(gstRatePercent: number): string {
  return `Sales @ ${gstRatePercent}% GST`;
}

export function tallyRowsForOrder(order: TallyOrderInput): TallyRow[] {
  const base = {
    "Voucher Type": TALLY_VOUCHER_TYPE,
    "Voucher No": order.orderNumber,
    Date: istDateDDMMYYYY(order.createdAt),
    "Debtor/Retailer": `${order.retailer.shopName}, ${order.retailer.area}`,
  };
  const rows: TallyRow[] = [];
  for (const l of order.lines) {
    rows.push({
      ...base,
      Item: `${l.skuName} (${l.skuCode}) - case of ${l.caseSize}`,
      Qty: `${l.qtyCases} Case`,
      Rate: paiseToRupeeString(l.unitPricePaise),
      Discount: paiseToRupeeString(l.discountPaise),
      Amount: paiseToRupeeString(l.subtotalPaise),
      GST: paiseToRupeeString(l.gstPaise),
      Ledger: salesLedger(l.gstRatePercent),
    });
    if (l.freeCases > 0) {
      rows.push({
        ...base,
        Item: `${l.skuName} (${l.skuCode}) - free goods${l.schemeLabel ? `: ${l.schemeLabel}` : ""}`,
        Qty: `${l.freeCases} Case`,
        Rate: "0.00",
        Discount: "0.00",
        Amount: "0.00",
        GST: "0.00",
        Ledger: "Free goods (scheme)",
      });
    }
  }
  return rows;
}

/**
 * RFC 4180 quoting, plus a leading apostrophe on text that a spreadsheet would treat
 * as a formula (=, +, -, @), so a shop name can never execute in Excel.
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) && !/^-?\d+(\.\d+)?$/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: readonly TallyRow[]): string {
  const lines = [TALLY_COLUMNS.map(csvCell).join(",")];
  for (const r of rows) lines.push(TALLY_COLUMNS.map((c) => csvCell(r[c])).join(","));
  return lines.join("\r\n") + "\r\n";
}

export function tallyCsvForOrders(orders: readonly TallyOrderInput[]): string {
  return toCsv(orders.flatMap(tallyRowsForOrder));
}
