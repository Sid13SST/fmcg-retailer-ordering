import { describe, expect, it, vi } from "vitest";
import {
  AiExtractionError,
  GeminiProvider,
  OfflineParserProvider,
  engineMode,
  fromGeminiLine,
  geminiModels,
  selectProvider,
  validateGeminiText,
} from "@/lib/ai-capture";
import { BRIEF_SAMPLE_ORDER_MESSAGE } from "@/prisma/seed-data";

const CATALOG = [{ code: "SKU-BS-075", name: "Glucose biscuit 75 g", brand: "Narmada Foods" }];

const GOOD = JSON.stringify([
  { raw_phrase: "5 peti biscuit chhota", qty: 5, unit_hint: "peti", sku_guess: "SKU-BS-075" },
  { raw_phrase: "2 peti washing powder 1 kilo", qty: 2, unit_hint: "peti", sku_guess: "SKU-DT-1KG" },
  { raw_phrase: "chai patti 250 wala 1 peti", qty: 1, unit_hint: "peti", sku_guess: null },
]);

function geminiBody(text: string) {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

/** A fetch mock that replies with the given (status, text) pairs in order and records calls. */
function mockFetch(replies: Array<[number, string]>) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: { contents: unknown[] } }> = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) });
    const [status, text] = replies[calls.length - 1] ?? [500, ""];
    return new Response(status === 200 ? JSON.stringify(geminiBody(text)) : JSON.stringify({ error: { code: status } }), { status });
  });
  return { fetchImpl: fn as unknown as typeof fetch, calls };
}

describe("Gemini output validation (zod)", () => {
  it("accepts the strict array shape", () => {
    expect(validateGeminiText(GOOD)).toMatchObject({ ok: true });
  });

  it.each([
    ["not JSON at all", "Sure! Here is your order: 5 peti biscuit"],
    ["object instead of array", JSON.stringify({ lines: [] })],
    ["qty as a word", JSON.stringify([{ raw_phrase: "5 peti biscuit", qty: "five", unit_hint: "peti", sku_guess: null }])],
    ["negative qty", JSON.stringify([{ raw_phrase: "biscuit", qty: -2, unit_hint: null, sku_guess: null }])],
    ["fractional qty", JSON.stringify([{ raw_phrase: "biscuit", qty: 1.5, unit_hint: null, sku_guess: null }])],
    ["missing raw_phrase", JSON.stringify([{ qty: 5, unit_hint: "peti", sku_guess: null }])],
    ["unexpected extra key", JSON.stringify([{ raw_phrase: "biscuit", qty: 5, unit_hint: "peti", sku_guess: null, price: 10 }])],
  ])("rejects %s", (_label, text) => {
    expect(validateGeminiText(text).ok).toBe(false);
  });
});

describe("GeminiProvider with a mocked fetch", () => {
  it("parses a valid reply in one call and cross-checks lines", async () => {
    const { fetchImpl, calls } = mockFetch([[200, GOOD]]);
    const res = await new GeminiProvider({ fetchImpl }).extract(BRIEF_SAMPLE_ORDER_MESSAGE, CATALOG);
    expect(res).toMatchObject({ engine: "GEMINI", model: "gemini-flash-latest", calls: 1 });
    expect(res.lines.map((l) => [l.productText, l.qty, l.unit, l.skuGuess, l.notes])).toEqual([
      ["biscuit chhota", 5, "CASE", "SKU-BS-075", []],
      ["washing powder 1 kilo", 2, "CASE", "SKU-DT-1KG", []],
      ["chai patti 250 wala", 1, "CASE", null, []],
    ]);
    expect(calls[0]!.url).toContain("/models/gemini-flash-latest:generateContent");
  });

  it("retries once with a repair prompt after malformed JSON, then succeeds", async () => {
    const { fetchImpl, calls } = mockFetch([
      [200, "```json\n[{raw_phrase: 5 peti biscuit}]\n```"],
      [200, GOOD],
    ]);
    const res = await new GeminiProvider({ fetchImpl }).extract(BRIEF_SAMPLE_ORDER_MESSAGE, CATALOG);
    expect(res.calls).toBe(2);
    expect(res.lines).toHaveLength(3);
    // The repair turn shows the model its own output and the rejection reason.
    const repairContents = calls[1]!.body.contents as Array<{ role: string; parts: Array<{ text: string }> }>;
    expect(repairContents.map((c) => c.role)).toEqual(["user", "model", "user"]);
    expect(repairContents[2]!.parts[0]!.text).toMatch(/rejected/);
  });

  it("fails honestly after the repair attempt is also malformed (no guessed lines)", async () => {
    const bad = JSON.stringify([{ raw_phrase: "biscuit", qty: "five", unit_hint: null, sku_guess: null }]);
    const { fetchImpl, calls } = mockFetch([
      [200, bad],
      [200, "still not json"],
    ]);
    const err = await new GeminiProvider({ fetchImpl }).extract("5 biscuit", CATALOG).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiExtractionError);
    expect(err).toMatchObject({ code: "INVALID_OUTPUT" });
    expect(calls).toHaveLength(2);
  });

  it.each([404, 429, 503])("falls back to gemini-3.5-flash-lite on HTTP %i", async (status) => {
    const { fetchImpl, calls } = mockFetch([
      [status, ""],
      [200, GOOD],
    ]);
    const res = await new GeminiProvider({ fetchImpl }).extract(BRIEF_SAMPLE_ORDER_MESSAGE, CATALOG);
    expect(res.model).toBe("gemini-3.5-flash-lite");
    expect(calls.map((c) => c.url.split("/models/")[1])).toEqual([
      "gemini-flash-latest:generateContent",
      "gemini-3.5-flash-lite:generateContent",
    ]);
  });

  it("does not fall back on auth errors", async () => {
    const { fetchImpl, calls } = mockFetch([[403, ""]]);
    await expect(new GeminiProvider({ fetchImpl }).extract("5 peti biscuit", CATALOG)).rejects.toMatchObject({ code: "HTTP_ERROR", httpStatus: 403 });
    expect(calls).toHaveLength(1);
  });

  it("reports every model tried when all are unavailable", async () => {
    const { fetchImpl } = mockFetch([
      [503, ""],
      [404, ""],
    ]);
    await expect(new GeminiProvider({ fetchImpl }).extract("5 peti biscuit", CATALOG)).rejects.toThrow(
      /gemini-flash-latest: HTTP 503; gemini-3.5-flash-lite: HTTP 404/,
    );
  });

  it("sends x-goog-api-key only when a key is configured (never in proxy mode)", async () => {
    const withKey = mockFetch([[200, GOOD]]);
    await new GeminiProvider({ apiKey: "test-key-not-real", fetchImpl: withKey.fetchImpl }).extract("5 peti biscuit", CATALOG);
    expect(withKey.calls[0]!.headers["x-goog-api-key"]).toBe("test-key-not-real");
    expect(withKey.calls[0]!.url).not.toContain("key=");

    const viaProxy = mockFetch([[200, GOOD]]);
    await new GeminiProvider({ fetchImpl: viaProxy.fetchImpl }).extract("5 peti biscuit", CATALOG);
    expect(viaProxy.calls[0]!.headers).not.toHaveProperty("x-goog-api-key");
  });
});

describe("AI cross-checks against the retailer's words", () => {
  it("ignores a unit the AI invented and asks instead", () => {
    const line = fromGeminiLine({ raw_phrase: "biscuit chhota 5", qty: 5, unit_hint: "peti", sku_guess: null }, "biscuit chhota 5");
    expect(line.unit).toBe("UNKNOWN");
    expect(line.notes).toContain("UNIT_NOT_IN_TEXT");
  });

  it("flags reworded phrases and quantity disagreements", () => {
    const line = fromGeminiLine({ raw_phrase: "5 cases glucose biscuit", qty: 6, unit_hint: "cases", sku_guess: null }, "5 peti biscuit");
    expect(line.notes).toEqual(expect.arrayContaining(["AI_REWORDED", "QTY_CHECK"]));
  });
});

describe("engine selection", () => {
  it("key -> Gemini with header; proxy flag -> Gemini without; neither -> offline", () => {
    expect(engineMode({ GEMINI_API_KEY: "x" })).toBe("GEMINI_KEY");
    expect(engineMode({ GEMINI_VIA_PROXY: "1" })).toBe("GEMINI_PROXY");
    expect(engineMode({ GEMINI_VIA_PROXY: "true" })).toBe("OFFLINE");
    expect(engineMode({})).toBe("OFFLINE");
    expect(selectProvider({})).toBeInstanceOf(OfflineParserProvider);
    expect(selectProvider({ GEMINI_API_KEY: "x" })).toBeInstanceOf(GeminiProvider);
    expect(selectProvider({ GEMINI_API_KEY: "x" }, { forceOffline: true })).toBeInstanceOf(OfflineParserProvider);
  });

  it("model names default to the spec and can be overridden by env", () => {
    expect(geminiModels({})).toEqual(["gemini-flash-latest", "gemini-3.5-flash-lite"]);
    expect(geminiModels({ GEMINI_FALLBACK_MODEL: "gemini-2.5-flash-lite" })).toEqual(["gemini-flash-latest", "gemini-2.5-flash-lite"]);
    expect(geminiModels({ GEMINI_MODEL: "gemini-3.5-flash-lite" })).toEqual(["gemini-3.5-flash-lite"]);
  });
});
