import { describe, expect, it } from "vitest";
import { describeScheme, maxOrderableCases, priceLine } from "@/lib/scheme-engine";
import { biscuit, biscuitScheme, detergent, detergentScheme, tea } from "./fixtures";

describe("free-goods scheme (Buy 10 cases get 1 free)", () => {
  it("label matches the brief verbatim", () => {
    expect(describeScheme(biscuitScheme)).toBe("Buy 10 cases get 1 free");
  });

  it("9 cases: no free goods, hint to add 1 more", () => {
    const l = priceLine(biscuit, 9, biscuitScheme);
    expect(l.orderable).toBe(true);
    expect(l.freeCases).toBe(0);
    expect(l.shippedCases).toBe(9);
    expect(l.schemeLabel).toBeNull();
    expect(l.schemeHint).toBe("Add 1 more case to get 1 free");
    expect(l.subtotalPaise).toBe(7290);
  });

  it("10 cases: 1 free, price unchanged, shipped 11", () => {
    const l = priceLine(biscuit, 10, biscuitScheme);
    expect(l.freeCases).toBe(1);
    expect(l.shippedCases).toBe(11);
    expect(l.discountPercent).toBe(0);
    expect(l.unitPricePaise).toBe(810);
    expect(l.subtotalPaise).toBe(8100);
    expect(l.gstPaise).toBe(1458); // 18%
    expect(l.totalPaise).toBe(9558);
    expect(l.schemeLabel).toBe("Buy 10 cases get 1 free");
  });

  it("19 cases: still only 1 free", () => {
    const l = priceLine(biscuit, 19, biscuitScheme);
    expect(l.freeCases).toBe(1);
    expect(l.shippedCases).toBe(20);
    expect(l.schemeHint).toBe("Add 1 more case to get 1 free");
  });

  it("20 cases: 2 free", () => {
    const l = priceLine(biscuit, 20, biscuitScheme);
    expect(l.freeCases).toBe(2);
    expect(l.shippedCases).toBe(22);
    expect(l.schemeHint).toBeNull();
  });

  it("free goods consume stock (A4): ordered fits but ordered + free does not", () => {
    const l = priceLine({ ...biscuit, stockCases: 10 }, 10, biscuitScheme);
    expect(l.orderable).toBe(false);
    expect(l.reasonCode).toBe("INSUFFICIENT_STOCK");
    expect(l.reason).toContain("needs 11 (10 ordered + 1 free)");
  });

  it("inactive scheme is ignored", () => {
    const l = priceLine(biscuit, 20, { ...biscuitScheme, active: false });
    expect(l.freeCases).toBe(0);
    expect(l.schemeLabel).toBeNull();
  });
});

describe("slab scheme (3% off on 5 or more cases)", () => {
  it("label matches the brief verbatim", () => {
    expect(describeScheme(detergentScheme)).toBe("3% off on 5 or more cases");
  });

  it("4 cases: no discount", () => {
    const l = priceLine(detergent, 4, detergentScheme);
    expect(l.discountPercent).toBe(0);
    expect(l.discountPaise).toBe(0);
    expect(l.subtotalPaise).toBe(40600);
    expect(l.gstPaise).toBe(7308);
    expect(l.totalPaise).toBe(47908);
    expect(l.schemeHint).toBe("Add 1 more case to get 3% off");
  });

  it("5 cases: 3% off the entire line (A5), rounded half-up", () => {
    const l = priceLine(detergent, 5, detergentScheme);
    expect(l.discountPercent).toBe(3);
    expect(l.grossPaise).toBe(50750);
    expect(l.discountPaise).toBe(1523); // 1522.5 -> 1523
    expect(l.subtotalPaise).toBe(49227);
    expect(l.gstPaise).toBe(8861); // 8860.86 -> 8861
    expect(l.totalPaise).toBe(58088);
    expect(l.freeCases).toBe(0);
    expect(l.schemeLabel).toBe("3% off on 5 or more cases");
  });

  it("6 cases: 3% off all 6 cases", () => {
    const l = priceLine(detergent, 6, detergentScheme);
    expect(l.discountPaise).toBe(1827);
    expect(l.subtotalPaise).toBe(59073);
    expect(l.gstPaise).toBe(10633); // 10633.14 -> 10633
    expect(l.totalPaise).toBe(69706);
  });
});

describe("no scheme", () => {
  it("prices plain qty x dealer price + GST", () => {
    const l = priceLine({ ...tea, stockCases: 50 }, 3);
    expect(l.orderable).toBe(true);
    expect(l.subtotalPaise).toBe(35400);
    expect(l.gstPaise).toBe(1770); // 5%
    expect(l.totalPaise).toBe(37170);
    expect(l.freeCases).toBe(0);
    expect(l.schemeLabel).toBeNull();
    expect(l.schemeHint).toBeNull();
  });

  it("rejects a scheme belonging to another SKU", () => {
    expect(() => priceLine(detergent, 5, biscuitScheme)).toThrow();
  });
});

describe("zero quantity", () => {
  it("is not orderable and has zero money", () => {
    const l = priceLine(biscuit, 0, biscuitScheme);
    expect(l.orderable).toBe(false);
    expect(l.reasonCode).toBe("ZERO_QUANTITY");
    expect(l.totalPaise).toBe(0);
    expect(l.freeCases).toBe(0);
  });

  it("rejects negative or fractional quantities as invalid input", () => {
    expect(() => priceLine(biscuit, -1)).toThrow();
    expect(() => priceLine(biscuit, 1.5)).toThrow();
  });
});

describe("stock", () => {
  it("out-of-stock SKU is never orderable, with a reason", () => {
    const l = priceLine(tea, 1);
    expect(l.orderable).toBe(false);
    expect(l.reasonCode).toBe("OUT_OF_STOCK");
    expect(l.reason).toBe("SKU-TE-250 is out of stock");
  });

  it("ordering more than stock is not silently fulfillable", () => {
    const l = priceLine(detergent, 86, detergentScheme);
    expect(l.orderable).toBe(false);
    expect(l.reasonCode).toBe("INSUFFICIENT_STOCK");
  });

  it("ordering exactly the stock is fine", () => {
    expect(priceLine(detergent, 85, detergentScheme).orderable).toBe(true);
  });
});

describe("maxOrderableCases", () => {
  it("returns the request when it fits", () => {
    expect(maxOrderableCases(detergent, 10, detergentScheme)).toBe(10);
  });
  it("caps at stock for no-scheme / slab SKUs", () => {
    expect(maxOrderableCases(detergent, 100, detergentScheme)).toBe(85);
  });
  it("leaves room for free cases (A4)", () => {
    // stock 10: 10 ordered would ship 11, so 9 is the max
    expect(maxOrderableCases({ stockCases: 10 }, 10, biscuitScheme)).toBe(9);
    // stock 11: 10 + 1 free fits exactly
    expect(maxOrderableCases({ stockCases: 11 }, 15, biscuitScheme)).toBe(10);
    // stock 340: 310 would ship 341; 309 ships 339
    expect(maxOrderableCases(biscuit, 340, biscuitScheme)).toBe(309);
  });
  it("is 0 when out of stock", () => {
    expect(maxOrderableCases(tea, 5)).toBe(0);
  });
});
