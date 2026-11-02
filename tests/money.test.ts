import { describe, expect, it } from "vitest";
import {
  applyBasisPoints,
  divRoundHalfUp,
  formatINR,
  paiseToRupeeString,
  percentToBasisPoints,
  rupeesToPaise,
} from "@/lib/money";

describe("divRoundHalfUp", () => {
  it("rounds .5 up and below .5 down", () => {
    expect(divRoundHalfUp(15, 10)).toBe(2);
    expect(divRoundHalfUp(14, 10)).toBe(1);
    expect(divRoundHalfUp(25, 10)).toBe(3); // not banker's rounding
    expect(divRoundHalfUp(0, 10)).toBe(0);
  });
  it("rejects non-integers and bad denominators", () => {
    expect(() => divRoundHalfUp(1.5, 10)).toThrow(RangeError);
    expect(() => divRoundHalfUp(1, 0)).toThrow(RangeError);
  });
});

describe("paise rounding", () => {
  it("3% of Rs 507.50 is 1522.5 paise -> 1523 (half-up)", () => {
    expect(applyBasisPoints(50750, percentToBasisPoints(3))).toBe(1523);
  });
  it("18% GST of 49227 paise is 8860.86 -> 8861", () => {
    expect(applyBasisPoints(49227, 1800)).toBe(8861);
  });
  it("5% GST of 12345 paise is 617.25 -> 617", () => {
    expect(applyBasisPoints(12345, 500)).toBe(617);
  });
  it("handles fractional percents without float drift", () => {
    expect(percentToBasisPoints(2.5)).toBe(250);
    expect(percentToBasisPoints(0.1 + 0.2)).toBe(30);
  });
});

describe("rupee <-> paise conversion", () => {
  it("parses brief prices exactly", () => {
    expect(rupeesToPaise("8.10")).toBe(810);
    expect(rupeesToPaise("101.50")).toBe(10150);
    expect(rupeesToPaise("118.00")).toBe(11800);
    expect(rupeesToPaise("101.5")).toBe(10150);
    expect(rupeesToPaise("1,180")).toBe(118000);
  });
  it("rounds a third decimal half-up", () => {
    expect(rupeesToPaise("8.105")).toBe(811);
    expect(rupeesToPaise("8.104")).toBe(810);
    expect(rupeesToPaise("0.005")).toBe(1);
  });
  it("avoids binary float error (1.005 would be 100 with Math.round)", () => {
    expect(rupeesToPaise("1.005")).toBe(101);
  });
  it("rejects garbage", () => {
    expect(() => rupeesToPaise("abc")).toThrow(RangeError);
  });
  it("formats paise for display", () => {
    expect(paiseToRupeeString(810)).toBe("8.10");
    expect(paiseToRupeeString(5)).toBe("0.05");
    expect(formatINR(1234567)).toBe("₹12,345.67");
    expect(formatINR(10150)).toBe("₹101.50");
  });
});
