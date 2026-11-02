import { describe, expect, it } from "vitest";
import { getMessages, parseLocale, schemeBadge } from "@/lib/i18n";
import { fmt, plural } from "@/lib/i18n-format";

function keysOf(obj: object, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === "object" && v !== null ? keysOf(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe("i18n", () => {
  it("defaults to English and rejects unknown locales", () => {
    expect(parseLocale(undefined)).toBe("en");
    expect(parseLocale("fr")).toBe("en");
    expect(parseLocale("hi")).toBe("hi");
  });

  it("Hindi has every English key and no empty strings", () => {
    const en = getMessages("en");
    const hi = getMessages("hi");
    expect(keysOf(hi).sort()).toEqual(keysOf(en).sort());
    for (const key of keysOf(hi)) {
      const value = key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], hi);
      expect(value, key).not.toBe("");
    }
  });

  it("keeps the same placeholders in both languages", () => {
    const en = getMessages("en");
    const hi = getMessages("hi");
    const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const key of keysOf(en)) {
      const get = (m: object) => key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], m) as string;
      expect(placeholders(get(hi)), key).toEqual(placeholders(get(en)));
    }
  });

  it("formats templates and scheme badges", () => {
    expect(fmt("per case of {n}", { n: 96 })).toBe("per case of 96");
    expect(fmt("keep {missing}")).toBe("keep {missing}");
    expect(plural(1, "{n} case", "{n} cases")).toBe("1 case");
    expect(plural(3, "{n} case", "{n} cases")).toBe("3 cases");
    const scheme = { type: "BUY_X_GET_Y_FREE" as const, thresholdCases: 10, freeCases: 1, percentOff: 0 };
    expect(schemeBadge(getMessages("en"), scheme)).toBe("Buy 10 get 1 free");
    expect(schemeBadge(getMessages("hi"), scheme)).toBe("10 पेटी पर 1 मुफ़्त");
    expect(schemeBadge(getMessages("en"), { type: "SLAB_PERCENT_OFF", thresholdCases: 5, freeCases: 0, percentOff: 3 })).toBe(
      "3% off on 5+ cases",
    );
  });
});
