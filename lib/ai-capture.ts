/**
 * Order-line extraction from free text (WhatsApp-style Hinglish).
 *
 * Two providers behind one interface:
 *  - GeminiProvider: Google Gemini, strict JSON validated with zod, one repair retry,
 *    then an honest failure. Never falls back silently.
 *  - OfflineParserProvider: deterministic tokenizer used when no AI is configured.
 *
 * Providers only read text into lines (words, qty, unit). Mapping words to SKUs is
 * done afterwards by lib/sku-matcher.ts for both engines, so confidence rules are
 * the same whichever engine ran.
 *
 * Secrets: the Gemini key is read from process.env.GEMINI_API_KEY and only ever sent
 * in the x-goog-api-key request header. It is never logged, returned or stored.
 */
import { z } from "zod";
import {
  FILLER_WORDS,
  MEASURE_WORDS,
  normalizeText,
  numberValue,
  tokenize,
  unitOf,
  type PackUnit,
} from "./hinglish";

export type CaptureEngineId = "GEMINI" | "OFFLINE";
export type LineUnit = PackUnit | "UNKNOWN";

/** Flags the UI must surface on a line. */
export type ExtractionNote =
  /** AI's raw_phrase is not a verbatim part of the message. */
  | "AI_REWORDED"
  /** AI's quantity differs from the number written in the words. */
  | "QTY_CHECK"
  /** AI claimed a unit word that does not appear in the message; ignored. */
  | "UNIT_NOT_IN_TEXT";

export interface ExtractedLine {
  /** The retailer's own words for this line, shown on every card. */
  rawPhrase: string;
  /** Words describing the product (quantity, unit and filler removed). */
  productText: string;
  /** Null when no quantity was written: the UI asks, it never assumes 1. */
  qty: number | null;
  /** Unit word as written ("peti", "dabba"), or null. */
  unitWord: string | null;
  unit: LineUnit;
  /** SKU code suggested by the AI (Gemini only), a hint for the matcher. */
  skuGuess: string | null;
  notes: ExtractionNote[];
}

export interface ExtractionResult {
  engine: CaptureEngineId;
  /** Model id that answered (Gemini), null for the offline parser. */
  model: string | null;
  lines: ExtractedLine[];
  /** Validated raw output from the AI (stored in AICapture.parsedJson for audit). */
  aiRaw: GeminiLine[] | null;
  /** Number of model calls made, including fallback and repair. */
  calls: number;
}

export interface CatalogHint {
  code: string;
  name: string;
  brand: string;
}

export interface ExtractionProvider {
  readonly engine: CaptureEngineId;
  extract(text: string, catalog: readonly CatalogHint[]): Promise<ExtractionResult>;
}

export const ENGINE_LABEL: Record<CaptureEngineId, string> = {
  GEMINI: "AI (Gemini)",
  OFFLINE: "Offline parser - no AI key configured",
};

export const MAX_MESSAGE_CHARS = 2000;

export class AiExtractionError extends Error {
  constructor(
    public code: "INVALID_OUTPUT" | "UNAVAILABLE" | "HTTP_ERROR" | "NETWORK",
    message: string,
    public httpStatus?: number,
  ) {
    super(message);
    this.name = "AiExtractionError";
  }
}

// ---------------------------------------------------------------------------
// Deterministic segment parsing (used by the offline parser and to cross-check AI)
// ---------------------------------------------------------------------------

export interface ParsedSegment {
  productText: string;
  qty: number | null;
  unitWord: string | null;
  unit: LineUnit;
}

/**
 * Read quantity and unit from one line's words.
 * 1. A number followed by a pack unit ("5 peti", "do dabba") is the quantity.
 * 2. Otherwise a bare number at the start or end of the line ("biscuit 5") is the
 *    quantity with an UNKNOWN unit (the UI will ask case or piece).
 * A number followed by a measure word ("1 kilo", "250 wala") is a pack size and stays
 * in the product words. Number words that double as ordinary words ("do" = give) only
 * count before a unit or at the very start.
 */
/** "bhej do", "de do", "kar dena": the trailing word is the verb "give", not the number 2. */
const VERB_STEMS = new Set(["bhej", "bhejo", "de", "kar", "rakh", "bhijwa", "dila", "भेज", "दे"]);
const VERB_ENDINGS = new Set(["do", "dena", "dijiye", "dijie", "dalo", "दो", "देना"]);

function contentTokens(text: string): string[] {
  const raw = tokenize(text);
  return raw.filter((t, i) => !FILLER_WORDS.has(t) && !(VERB_ENDINGS.has(t) && VERB_STEMS.has(raw[i - 1] ?? "")));
}

export function parseSegment(text: string): ParsedSegment {
  const tokens = contentTokens(text);
  const used = new Set<number>();
  let qty: number | null = null;
  let unitWord: string | null = null;

  for (let i = 0; i < tokens.length - 1 && qty === null; i++) {
    const n = numberValue(tokens[i]!, { allowWeak: true });
    if (n !== null && n > 0 && unitOf(tokens[i + 1])) {
      qty = n;
      unitWord = tokens[i + 1]!;
      used.add(i).add(i + 1);
    }
  }
  if (qty === null) {
    const isBareQty = (i: number) => {
      const tok = tokens[i];
      if (tok === undefined) return null;
      const n = numberValue(tok, { allowWeak: i === 0 });
      if (n === null || n <= 0) return null;
      if (MEASURE_WORDS.has(tokens[i + 1] ?? "")) return null; // "250 wala" is a size
      return n;
    };
    for (const i of [0, tokens.length - 1]) {
      const n = isBareQty(i);
      if (n !== null && tokens.length > 1) {
        qty = n;
        used.add(i);
        break;
      }
    }
  }
  // An unpaired unit word ("peti biscuit") still tells us the unit.
  if (!unitWord) {
    const idx = tokens.findIndex((t, i) => !used.has(i) && unitOf(t));
    if (idx >= 0) unitWord = tokens[idx]!;
  }
  const productTokens = tokens.filter((t, i) => !used.has(i) && !unitOf(t));
  return {
    productText: productTokens.join(" "),
    qty,
    unitWord,
    unit: unitOf(unitWord ?? undefined) ?? "UNKNOWN",
  };
}

/** Split a message into item segments on punctuation, newlines and "aur"/"and". */
export function splitSegments(text: string): string[] {
  const coarse = text
    .split(/[,;\n\r।|+]+|\s(?:aur|and|&|और)\s/i)
    .map((s) => s.trim())
    .filter(Boolean);
  return coarse.flatMap(splitRunOn);
}

/**
 * "5 peti biscuit 2 peti surf" has two qty+unit pairs in one segment: split it.
 * If the first pair starts the segment, quantities precede products; otherwise they follow.
 */
function splitRunOn(segment: string): string[] {
  const tokens = normalizeText(segment).split(" ").filter(Boolean);
  const pairs: number[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    if (numberValue(tokens[i]!, { allowWeak: true }) !== null && unitOf(tokens[i + 1])) pairs.push(i);
  }
  if (pairs.length < 2) return [segment];
  const contentStart = tokens.findIndex((t) => !FILLER_WORDS.has(t));
  const qtyFirst = pairs[0] === contentStart;
  const cuts = qtyFirst ? pairs.slice(1) : pairs.slice(0, -1).map((p) => p + 2);
  const out: string[] = [];
  let start = 0;
  for (const c of cuts) {
    out.push(tokens.slice(start, c).join(" "));
    start = c;
  }
  out.push(tokens.slice(start).join(" "));
  return out.filter((s) => s.trim());
}

// ---------------------------------------------------------------------------
// Offline parser
// ---------------------------------------------------------------------------

export class OfflineParserProvider implements ExtractionProvider {
  readonly engine = "OFFLINE" as const;

  async extract(text: string): Promise<ExtractionResult> {
    const lines: ExtractedLine[] = [];
    for (const segment of splitSegments(text)) {
      const p = parseSegment(segment);
      if (!p.productText && p.qty === null) continue; // pure filler, e.g. "bhaiya"
      lines.push({ rawPhrase: segment, ...p, skuGuess: null, notes: [] });
    }
    return { engine: "OFFLINE", model: null, lines, aiRaw: null, calls: 0 };
  }
}

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

export const geminiLineSchema = z
  .object({
    raw_phrase: z.string().trim().min(1).max(300),
    qty: z.number().int().positive().max(9999).nullable(),
    unit_hint: z.string().trim().max(40).nullable(),
    sku_guess: z.string().trim().max(40).nullable(),
  })
  .strict();
export const geminiOutputSchema = z.array(geminiLineSchema).max(50);
export type GeminiLine = z.infer<typeof geminiLineSchema>;

export const GEMINI_MODELS = ["gemini-flash-latest", "gemini-2.5-flash-lite"] as const;
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/** Parse model text into validated lines, or return a readable reason. */
export function validateGeminiText(text: string): { ok: true; lines: GeminiLine[] } | { ok: false; error: string } {
  let data: unknown;
  try {
    data = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return { ok: false, error: "Response is not valid JSON." };
  }
  const parsed = geminiOutputSchema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `JSON does not match the schema at ${issue?.path.join(".") || "(root)"}: ${issue?.message}` };
  }
  return { ok: true, lines: parsed.data };
}

function systemPrompt(catalog: readonly CatalogHint[]): string {
  return [
    "You read wholesale order messages that Indian kirana shop owners send on WhatsApp, often in Hinglish (Hindi in Latin script) mixed with English.",
    "Extract every ordered item as one object. Reply with ONLY a JSON array, no prose. Each object has exactly these keys:",
    '- "raw_phrase": the exact words of the message for that item, copied verbatim including the quantity and unit words. Do not translate, correct spelling or reword.',
    '- "qty": the integer quantity written for that item (convert number words, e.g. "paanch" = 5, "do" = 2), or null if no quantity is written. Never assume 1.',
    '- "unit_hint": the unit word exactly as written next to the quantity (e.g. "peti", "case", "dabba", "piece", "packet"), or null if none is written. Do not convert or infer a unit.',
    '- "sku_guess": the code of the catalogue item it most likely refers to, only if you are reasonably sure; otherwise null. Use only codes from the list.',
    'Sizes such as "1 kilo", "250 wala", "500 g" describe the product, they are not quantities. Ignore greetings like "bhaiya".',
    "Catalogue (code | name | brand):",
    ...catalog.map((c) => `${c.code} | ${c.name} | ${c.brand}`),
  ].join("\n");
}

const RESPONSE_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      raw_phrase: { type: "STRING" },
      qty: { type: "INTEGER", nullable: true },
      unit_hint: { type: "STRING", nullable: true },
      sku_guess: { type: "STRING", nullable: true },
    },
    required: ["raw_phrase", "qty", "unit_hint", "sku_guess"],
  },
};

type Content = { role: "user" | "model"; parts: Array<{ text: string }> };

export interface GeminiOptions {
  /** Sent as x-goog-api-key. Omit when a trusted egress proxy injects the key (GEMINI_VIA_PROXY=1). */
  apiKey?: string;
  fetchImpl?: typeof fetch;
  models?: readonly string[];
  timeoutMs?: number;
}

export class GeminiProvider implements ExtractionProvider {
  readonly engine = "GEMINI" as const;
  private readonly fetchImpl: typeof fetch;
  private readonly models: readonly string[];
  private readonly timeoutMs: number;
  private readonly apiKey: string | undefined;

  constructor(opts: GeminiOptions = {}) {
    this.apiKey = opts.apiKey || undefined;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.models = opts.models ?? GEMINI_MODELS;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
  }

  private async call(model: string, system: string, contents: Content[]): Promise<{ status: number; text: string | null }> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers["x-goog-api-key"] = this.apiKey;
    let res: Response;
    try {
      res = await this.fetchImpl(`${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents,
          generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new AiExtractionError("NETWORK", `Could not reach Gemini (${(err as Error).name}).`);
    }
    if (!res.ok) return { status: res.status, text: null };
    const body = (await res.json().catch(() => null)) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    } | null;
    const text = body?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    return { status: res.status, text };
  }

  async extract(message: string, catalog: readonly CatalogHint[]): Promise<ExtractionResult> {
    const system = systemPrompt(catalog);
    const userTurn: Content = { role: "user", parts: [{ text: `Order message:\n${message}` }] };
    let calls = 0;
    let model: string | null = null;
    let first: { status: number; text: string | null } | null = null;

    // Primary model, then fallback on 404 (model retired) or 429 (quota/rate limit).
    for (const m of this.models) {
      calls++;
      first = await this.call(m, system, [userTurn]);
      if (first.status === 404 || first.status === 429) continue;
      model = m;
      break;
    }
    if (!first || model === null) {
      throw new AiExtractionError("UNAVAILABLE", `Gemini models unavailable (HTTP ${first?.status ?? "?"}).`, first?.status);
    }
    if (first.text === null) {
      throw new AiExtractionError("HTTP_ERROR", `Gemini returned HTTP ${first.status}.`, first.status);
    }

    let result = validateGeminiText(first.text);
    if (!result.ok) {
      // One repair attempt: show the model its output and the validation error.
      calls++;
      const repair = await this.call(model, system, [
        userTurn,
        { role: "model", parts: [{ text: first.text.slice(0, 4000) }] },
        {
          role: "user",
          parts: [{ text: `That reply was rejected: ${result.error} Reply again with ONLY the corrected JSON array in the required shape.` }],
        },
      ]);
      if (repair.text === null) {
        throw new AiExtractionError("HTTP_ERROR", `Gemini returned HTTP ${repair.status} on repair.`, repair.status);
      }
      result = validateGeminiText(repair.text);
      if (!result.ok) {
        throw new AiExtractionError("INVALID_OUTPUT", `Gemini returned invalid output twice (${result.error}).`);
      }
    }

    return { engine: "GEMINI", model, lines: result.lines.map((l) => fromGeminiLine(l, message)), aiRaw: result.lines, calls };
  }
}

/**
 * Turn a validated AI line into an ExtractedLine, cross-checked against the words.
 * The deterministic reading of raw_phrase wins for the unit, so an AI cannot invent
 * "case" when the retailer wrote no unit.
 */
export function fromGeminiLine(l: GeminiLine, message: string): ExtractedLine {
  const notes: ExtractionNote[] = [];
  const normMessage = ` ${normalizeText(message)} `;
  if (!normMessage.includes(` ${normalizeText(l.raw_phrase)} `)) notes.push("AI_REWORDED");

  const p = parseSegment(l.raw_phrase);
  let unitWord = p.unitWord;
  if (!unitWord && l.unit_hint) {
    const hint = normalizeText(l.unit_hint);
    if (hint && normMessage.includes(` ${hint} `)) unitWord = hint;
    else notes.push("UNIT_NOT_IN_TEXT");
  }
  let qty = l.qty;
  if (p.qty !== null && l.qty !== null && p.qty !== l.qty) notes.push("QTY_CHECK");
  if (qty === null) qty = p.qty;

  return {
    rawPhrase: l.raw_phrase,
    productText: p.productText,
    qty,
    unitWord,
    unit: unitOf(unitWord ?? undefined) ?? "UNKNOWN",
    skuGuess: l.sku_guess ? l.sku_guess.toUpperCase() : null,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Provider selection
// ---------------------------------------------------------------------------

export type EngineMode = "GEMINI_KEY" | "GEMINI_PROXY" | "OFFLINE";

/**
 * GEMINI_API_KEY set -> Gemini, key sent in a header (normal local/production setup).
 * GEMINI_VIA_PROXY=1 -> Gemini with no key header; a trusted egress proxy adds it.
 * Neither -> offline parser, labeled as such in the UI.
 */
export function engineMode(env: Record<string, string | undefined> = process.env): EngineMode {
  if (env.GEMINI_API_KEY) return "GEMINI_KEY";
  if (env.GEMINI_VIA_PROXY === "1") return "GEMINI_PROXY";
  return "OFFLINE";
}

export function selectProvider(
  env: Record<string, string | undefined> = process.env,
  opts: { forceOffline?: boolean; fetchImpl?: typeof fetch } = {},
): ExtractionProvider {
  const mode = opts.forceOffline ? "OFFLINE" : engineMode(env);
  if (mode === "GEMINI_KEY") return new GeminiProvider({ apiKey: env.GEMINI_API_KEY, fetchImpl: opts.fetchImpl });
  if (mode === "GEMINI_PROXY") return new GeminiProvider({ fetchImpl: opts.fetchImpl });
  return new OfflineParserProvider();
}
