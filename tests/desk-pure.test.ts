import { describe, expect, it } from "vitest";
import { istDateDDMMYYYY, istDayRange } from "@/lib/desk/ist";
import { csvCell, tallyCsvForOrders, tallyRowsForOrder, TALLY_COLUMNS, type TallyOrderInput } from "@/lib/desk/tally";
import { availableActions, canPerform } from "@/lib/desk/transitions";

describe("desk status transitions", () => {
  it("only PENDING_DESK_REVIEW and ON_HOLD can be approved", () => {
    expect(canPerform("APPROVE", "PENDING_DESK_REVIEW")).toBe(true);
    expect(canPerform("APPROVE", "ON_HOLD")).toBe(true);
    for (const s of ["DRAFT", "CONFIRMED", "EXPORTED", "REJECTED"] as const) expect(canPerform("APPROVE", s)).toBe(false);
  });

  it("only CONFIRMED can be exported; REJECTED never", () => {
    expect(canPerform("EXPORT", "CONFIRMED")).toBe(true);
    for (const s of ["DRAFT", "PENDING_DESK_REVIEW", "ON_HOLD", "EXPORTED", "REJECTED"] as const) expect(canPerform("EXPORT", s)).toBe(false);
  });

  it("exported and rejected orders are final", () => {
    expect(availableActions("EXPORTED")).toEqual([]);
    expect(availableActions("REJECTED")).toEqual([]);
    expect(availableActions("ON_HOLD")).toEqual(["APPROVE", "REJECT", "CORRECT_LINE"]);
  });
});

describe("IST business day", () => {
  it("uses Asia/Kolkata midnight, not UTC", () => {
    // 2026-11-02 20:00 UTC is already 3 Nov 01:30 IST.
    const { start, end } = istDayRange(new Date("2026-11-02T20:00:00Z"));
    expect(start.toISOString()).toBe("2026-11-02T18:30:00.000Z");
    expect(end.toISOString()).toBe("2026-11-03T18:30:00.000Z");
    expect(istDateDDMMYYYY(new Date("2026-11-02T20:00:00Z"))).toBe("03-11-2026");
  });
});

const ORDER: TallyOrderInput = {
  orderNumber: "KOD-00042",
  createdAt: new Date("2026-11-02T05:00:00Z"),
  retailer: { shopName: "Agrawal Kirana Stores", area: "Napier Town" },
  lines: [
    { skuCode: "SKU-BS-075", skuName: "Glucose biscuit 75 g", caseSize: 96, qtyCases: 10, freeCases: 1, unitPricePaise: 810, discountPaise: 0, subtotalPaise: 8100, gstPaise: 1458, gstRatePercent: 18, schemeLabel: "Buy 10 get 1 free" },
    { skuCode: "SKU-DT-1KG", skuName: "Detergent powder 1 kg", caseSize: 20, qtyCases: 5, freeCases: 0, unitPricePaise: 10150, discountPaise: 1523, subtotalPaise: 49227, gstPaise: 8861, gstRatePercent: 18, schemeLabel: "3% off" },
  ],
};

describe("Tally CSV (mocked, A8)", () => {
  it("writes Tally-style columns with rupees from paise and a free-goods row", () => {
    const rows = tallyRowsForOrder(ORDER);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      "Voucher Type": "Sales Order",
      "Voucher No": "KOD-00042",
      Date: "02-11-2026",
      "Debtor/Retailer": "Agrawal Kirana Stores, Napier Town",
      Qty: "10 Case",
      Rate: "8.10",
      Amount: "81.00",
      GST: "14.58",
      Ledger: "Sales @ 18% GST",
    });
    expect(rows[1]).toMatchObject({ Qty: "1 Case", Rate: "0.00", Amount: "0.00", Ledger: "Free goods (scheme)" });
    expect(rows[2]).toMatchObject({ Rate: "101.50", Discount: "15.23", Amount: "492.27", GST: "88.61" });
  });

  it("emits one header and quotes cells with commas", () => {
    const csv = tallyCsvForOrders([ORDER, ORDER]);
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe(TALLY_COLUMNS.join(","));
    expect(lines).toHaveLength(1 + 6);
    expect(lines[1]).toContain('"Agrawal Kirana Stores, Napier Town"');
  });

  it("neutralises spreadsheet formulas in text cells", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("-12.50")).toBe("-12.50");
  });
});
