import { describe, expect, it } from "vitest";
import { getMessages } from "@/lib/i18n";
import { localizeNote, NOTE_SEPARATOR, systemNote } from "@/lib/orders/system-notes";

const en = getMessages("en");
const hi = getMessages("hi");

const samples = [
  systemNote.creditHold("₹1,234.50"),
  systemNote.correctionHold("₹10.00"),
  systemNote.shortConfirmed([
    { skuCode: "SKU-BS-075", requestedCases: 5, availableCases: 3 },
    { skuCode: "SKU-TE-250", requestedCases: 2, availableCases: 1 },
  ]),
  systemNote.captured("GEMINI"),
  systemNote.captured("OFFLINE"),
  systemNote.approved(),
  systemNote.approvedOverLimit("₹99.00"),
  systemNote.exported(false),
  systemNote.exported(true),
  "Order total exceeds available credit",
  "Captured from WhatsApp text",
];

describe("system notes", () => {
  it("translates every system template into Hindi (no English left)", () => {
    for (const note of samples) {
      const out = localizeNote(note, hi);
      expect(out, note).not.toBe(note);
      expect(out, note).not.toMatch(/\b(credit|order|desk|retailer|cases|Captured|Approved|Exported)\b/i);
    }
  });

  it("keeps amounts and SKU codes", () => {
    expect(localizeNote(systemNote.creditHold("₹1,234.50"), hi)).toContain("₹1,234.50");
    expect(localizeNote(systemNote.shortConfirmed([{ skuCode: "SKU-BS-075", requestedCases: 5, availableCases: 3 }]), hi)).toBe(
      "आपने कम मात्रा मंज़ूर की: SKU-BS-075 5 → 3 पेटी",
    );
  });

  it("is the identity in English for the notes retailers read in the record", () => {
    for (const note of samples.filter((n) => !n.startsWith("Exported"))) {
      expect(localizeNote(note, en)).toBe(note);
    }
  });

  it("translates each part of a joined note and leaves desk free text untouched", () => {
    const joined = [systemNote.captured("OFFLINE"), systemNote.shortConfirmed([{ skuCode: "X", requestedCases: 2, availableCases: 1 }])].join(NOTE_SEPARATOR);
    expect(localizeNote(joined, hi).split(NOTE_SEPARATOR)).toHaveLength(2);
    expect(localizeNote("Retailer asked to wait till Monday", hi)).toBe("Retailer asked to wait till Monday");
  });
});
