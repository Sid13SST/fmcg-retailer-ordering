import { describe, expect, it } from "vitest";
import { priceLine } from "@/lib/scheme-engine";
import { availableCreditPaise, computeOrderTotals, decideCredit, initialOrderStatus } from "@/lib/pricing";
import { biscuit, biscuitScheme, detergent, detergentScheme, tea } from "./fixtures";

describe("computeOrderTotals", () => {
  // The sample WhatsApp order: 5 biscuit, 2 detergent, 1 tea (tea is out of stock).
  const lines = [
    priceLine(biscuit, 5, biscuitScheme),
    priceLine(detergent, 2, detergentScheme),
    priceLine(tea, 1),
  ];
  const totals = computeOrderTotals(lines);

  it("sums only orderable lines and reports excluded ones", () => {
    expect(totals.lineCount).toBe(2);
    expect(totals.excludedLines).toEqual([{ skuCode: "SKU-TE-250", reason: "SKU-TE-250 is out of stock" }]);
  });

  it("computes subtotal, GST and grand total in paise", () => {
    // biscuit 5 x 810 = 4050, GST 729; detergent 2 x 10150 = 20300, GST 3654
    expect(totals.subtotalPaise).toBe(24350);
    expect(totals.gstPaise).toBe(4383);
    expect(totals.grandTotalPaise).toBe(28733);
    expect(totals.totalCases).toBe(7);
  });

  it("grand total equals sum of line totals and subtotal + GST", () => {
    const multi = computeOrderTotals([
      priceLine(biscuit, 20, biscuitScheme),
      priceLine(detergent, 5, detergentScheme),
    ]);
    expect(multi.grandTotalPaise).toBe(multi.subtotalPaise + multi.gstPaise);
    expect(multi.grandTotalPaise).toBe(19116 + 58088);
    expect(multi.discountPaise).toBe(1523);
    expect(multi.totalFreeCases).toBe(2);
  });

  it("empty order totals to zero", () => {
    expect(computeOrderTotals([]).grandTotalPaise).toBe(0);
  });
});

describe("credit hold decision", () => {
  const retailer = { creditLimitPaise: 50_000_00, creditUsedPaise: 30_000_00 }; // Rs 20,000 available

  it("available credit = limit - used", () => {
    expect(availableCreditPaise(retailer)).toBe(20_000_00);
  });

  it("exactly at the limit is OK", () => {
    const d = decideCredit(retailer, 20_000_00);
    expect(d.decision).toBe("OK");
    expect(d.shortfallPaise).toBe(0);
    expect(initialOrderStatus(d)).toBe("PENDING_DESK_REVIEW");
  });

  it("1 paise over goes ON_HOLD with a 1 paise shortfall", () => {
    const d = decideCredit(retailer, 20_000_01);
    expect(d.decision).toBe("ON_HOLD");
    expect(d.shortfallPaise).toBe(1);
    expect(initialOrderStatus(d)).toBe("ON_HOLD");
  });

  it("retailer already over limit has zero available; any order holds", () => {
    const over = { creditLimitPaise: 10_000_00, creditUsedPaise: 12_000_00 };
    expect(availableCreditPaise(over)).toBe(0);
    const d = decideCredit(over, 100);
    expect(d).toMatchObject({ decision: "ON_HOLD", shortfallPaise: 100 });
  });

  it("rejects non-integer totals", () => {
    expect(() => decideCredit(retailer, 10.5)).toThrow();
  });
});
