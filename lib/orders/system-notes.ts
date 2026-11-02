/**
 * Notes the system writes onto orders and status events. They are stored in English
 * (the desk's language and the audit record). Retailers see them translated by
 * `localizeNote`, which recognises exactly these templates; anything else (a reason the
 * desk typed) is shown verbatim. Writers must use these builders so the two stay in sync.
 */
import { fmt } from "../i18n-format";
import type { Messages } from "../i18n";

export interface ShortItem {
  skuCode: string;
  requestedCases: number;
  availableCases: number;
}

export const NOTE_SEPARATOR = " · ";

export const systemNote = {
  creditHold: (shortfall: string) => `Order total exceeds available credit by ${shortfall} — sent to desk for credit approval`,
  correctionHold: (shortfall: string) => `After desk correction the order exceeds available credit by ${shortfall}`,
  shortConfirmed: (items: ShortItem[]) =>
    "Short-confirmed by retailer: " + items.map((i) => `${i.skuCode} ${i.requestedCases} → ${i.availableCases} cases`).join("; "),
  captured: (engine: "GEMINI" | "OFFLINE") =>
    `Captured from text (${engine === "GEMINI" ? "AI (Gemini)" : "offline parser"}), confirmed by retailer`,
  approved: () => "Approved by order desk",
  approvedOverLimit: (overBy: string) => `Approved over credit limit by ${overBy}`,
  exported: (bulk: boolean) => (bulk ? "Exported to Tally (bulk CSV)" : "Exported to Tally (CSV)"),
};

type Sys = Messages["orders"]["sys"];

const PATTERNS: Array<[RegExp, (m: Sys, g: string[]) => string]> = [
  [/^Order total exceeds available credit by (.+) — sent to desk for credit approval$/, (m, g) => fmt(m.creditHold, { x: g[1]! })],
  [/^Order total exceeds available credit$/, (m) => m.creditHoldPlain],
  [/^After desk correction the order exceeds available credit by (.+)$/, (m, g) => fmt(m.correctionHold, { x: g[1]! })],
  [
    /^Short-confirmed by retailer: (.+)$/,
    (m, g) =>
      fmt(m.shortConfirmed, {
        items: g[1]!
          .split("; ")
          .map((part) => {
            const p = /^(\S+) (\d+) → (\d+) cases$/.exec(part);
            return p ? fmt(m.shortItem, { sku: p[1]!, from: p[2]!, to: p[3]! }) : part;
          })
          .join("; "),
      }),
  ],
  [/^Captured from text \(AI \(Gemini\)\), confirmed by retailer$/, (m) => m.capturedAi],
  [/^Captured from text \(offline parser\), confirmed by retailer$/, (m) => m.capturedOffline],
  [/^Captured from WhatsApp text$/, (m) => m.capturedDraft],
  [/^Approved by order desk$/, (m) => m.approved],
  [/^Approved over credit limit by (.+)$/, (m, g) => fmt(m.approvedOverLimit, { x: g[1]! })],
  [/^Exported to Tally \((bulk )?CSV\)$/, (m) => m.exported],
];

/** Translate system-written parts of a note; desk free text is returned unchanged. */
export function localizeNote(note: string, m: Messages): string {
  return note
    .split(NOTE_SEPARATOR)
    .map((part) => {
      for (const [re, render] of PATTERNS) {
        const g = re.exec(part);
        if (g) return render(m.orders.sys, [...g]);
      }
      return part;
    })
    .join(NOTE_SEPARATOR);
}
