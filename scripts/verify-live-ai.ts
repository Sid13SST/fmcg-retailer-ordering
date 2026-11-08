/**
 * Live check of the Gemini path for AI order capture.
 *
 *   npm run verify:ai             # live: list models, tiny prompt, 3 orders via the app's parser
 *   npm run verify:ai -- --offline  # no network at all: the same 3 orders via the offline parser
 *
 * The key is read from process.env.GEMINI_API_KEY (or from .env, which is gitignored).
 * It is only ever sent as the x-goog-api-key header; it is never printed, logged or written.
 * Needs a migrated + seeded database (npm run seed): step 3 runs the real capture service
 * (lib/capture/service.ts parseCapture) for a seeded retailer and stores PARSED captures
 * like the app does (no order is placed).
 *
 * Model: GEMINI_MODEL if set, otherwise a flash-lite model (free tier: ~500 requests/day,
 * 15 RPM; the non-lite flash free tier is only ~20/day). If the default lite model is not
 * listed for the key, the newest listed *flash-lite* model is used instead. The run uses
 * ONE model (no fallback to a non-lite model) and at most 8 API calls in total:
 * 1 list + 1 tiny prompt + 3 orders x (1 call + at most 1 repair retry).
 *
 * Exit codes: 0 ok · 1 other failure · 2 GEMINI_API_KEY missing ·
 *             3 quota / billing / permission error (exact API message printed) ·
 *             4 no flash-lite model listed for this key and GEMINI_MODEL not set.
 */
import { PrismaClient } from "@prisma/client";
import { geminiModels } from "../lib/ai-capture";
import { parseCapture } from "../lib/capture/service";

const API = "https://generativelanguage.googleapis.com/v1beta";
const RETAILER_PHONE = "9827000001"; // seeded Agrawal Kirana Stores
const DEFAULT_LITE_MODEL = "gemini-3.5-flash-lite";
const MAX_API_CALLS = 8;
let apiCalls = 0;

const ORDERS: Array<{ label: string; text: string }> = [
  { label: "English", text: "Please send 3 cases of detergent powder 1 kg and 2 cases of glucose biscuit 75 g" },
  { label: "Hinglish", text: "bhaiya 5 peti biscuit chhota, 2 peti washing powder 1 kilo, chai patti 250 wala 1 peti" },
  { label: "Hindi (Devanagari)", text: "भैया 4 पेटी नमकीन और 2 पेटी साबुन भेज देना" },
];

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public apiStatus: string | undefined,
  ) {
    super(message);
  }
}

const offline = process.argv.includes("--offline");

// .env is optional; values already in the environment win (Node >= 20.12).
try {
  process.loadEnvFile?.(".env");
} catch {
  // no .env file: rely on the real environment
}
const key = process.env.GEMINI_API_KEY?.trim() ?? "";

/** Defence in depth: never let the key reach stdout/stderr, even inside an echoed message. */
const scrub = (s: string) => (key ? s.split(key).join("[redacted]") : s);
const out = (...parts: unknown[]) => console.log(scrub(parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p, null, 2))).join(" ")));

function isQuotaBillingOrPermission(e: ApiError): boolean {
  if ([401, 403, 429].includes(e.status)) return true;
  if (e.apiStatus && ["PERMISSION_DENIED", "RESOURCE_EXHAUSTED", "UNAUTHENTICATED", "FAILED_PRECONDITION"].includes(e.apiStatus)) return true;
  return /quota|billing|permission|api key not valid|api_key_invalid/i.test(e.message);
}

/** Every request to Gemini (ours and the app's) goes through this budgeted fetch. */
function installCallBudget() {
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (++apiCalls > MAX_API_CALLS) {
      return Promise.reject(new Error(`API call budget of ${MAX_API_CALLS} reached; stopping to protect the free quota.`));
    }
    return realFetch(input, init);
  }) as typeof fetch;
}

/** The single model this run uses (also handed to the app code via GEMINI_MODEL). */
let runModel = "";
function selectRunModel(model: string) {
  runModel = model;
  process.env.GEMINI_MODEL = model;
  process.env.GEMINI_FALLBACK_MODEL = model; // geminiModels() -> [model]: no silent switch to another model
}

/** Prefer stable over preview, then the highest version number. */
function newestLite(names: string[]): string | null {
  const lite = names.filter((n) => /flash-lite/.test(n));
  const version = (n: string) => Number(/gemini-(\d+(?:\.\d+)?)/.exec(n)?.[1] ?? 0);
  const preview = (n: string) => (/preview|exp/.test(n) ? 1 : 0);
  lite.sort((a, b) => preview(a) - preview(b) || version(b) - version(a) || a.length - b.length);
  return lite[0] ?? null;
}

async function api(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${API}/${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "x-goog-api-key": key, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json().catch(() => null)) as { error?: { message?: string; status?: string } } | null;
  if (!res.ok) {
    throw new ApiError(body?.error?.message ?? `HTTP ${res.status}`, res.status, body?.error?.status);
  }
  return body;
}

/** Lists models (one call) and picks the run model. Returns false if no lite model is usable. */
async function listModelsAndPick(userModel: string | undefined): Promise<boolean> {
  out("\n[1] Models available to this key that support generateContent (names only)");
  // One page of up to 1000 covers the whole catalogue in a single call (call budget).
  const page = (await api("models?pageSize=1000")) as { models?: Array<{ name: string; supportedGenerationMethods?: string[] }> };
  const names = (page.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""));
  out(names.length ? names.map((n) => `  - ${n}`).join("\n") : "  (none)");

  if (userModel) {
    selectRunModel(userModel);
    out(`  Using GEMINI_MODEL=${userModel}${names.includes(userModel) ? "" : " (NOT in the list above; the call may fail)"}`);
    return true;
  }
  if (names.includes(DEFAULT_LITE_MODEL)) {
    selectRunModel(DEFAULT_LITE_MODEL);
    out(`  Using default lite model ${DEFAULT_LITE_MODEL}`);
    return true;
  }
  const lite = newestLite(names);
  if (lite) {
    selectRunModel(lite);
    out(`  ${DEFAULT_LITE_MODEL} is not listed; using the newest listed lite model ${lite}`);
    return true;
  }
  out(
    `  No flash-lite model is listed for this key. Only non-lite models are available, whose free quota is much smaller.` +
      ` Not choosing one automatically: set GEMINI_MODEL to one of the names above to run anyway.`,
  );
  return false;
}

async function tinyPrompt(): Promise<void> {
  const model = runModel;
  out(`\n[2] Tiny prompt on ${model}`);
  const body = (await api(`models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: "Reply with exactly one word: pong" }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 16 },
    }),
  })) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
  out(`  Response: ${JSON.stringify(text ?? "")}`);
}

async function captureOrders(): Promise<boolean> {
  out(`\n[3] App order-capture path (lib/capture/service.ts parseCapture)${offline ? " with the offline parser forced" : ""}`);
  const db = new PrismaClient();
  try {
    const retailer = await db.retailer.findUnique({ where: { phone: RETAILER_PHONE }, select: { id: true, shopName: true } });
    if (!retailer) throw new Error(`Seeded retailer ${RETAILER_PHONE} not found. Run: npm run seed`);
    let allOk = true;
    for (const o of ORDERS) {
      out(`\n  --- ${o.label}: ${o.text}`);
      const r = await parseCapture(db, retailer.id, o.text, { forceOffline: offline });
      if (!r.ok) {
        allOk = false;
        out(`  FAILED (${r.engineLabel}): ${r.message}`);
      if (/budget/.test(r.message)) break;
        continue;
      }
      const c = r.capture;
      out(`  Engine: ${c.engine}${c.model ? ` (model ${c.model})` : ""} - "${c.engineLabel}"`);
      out(
        c.lines.map((l) => ({
          wrote: l.rawPhrase,
          qty: l.qty,
          unit: l.unit,
          sku: l.skuId ? (c.skus[l.skuId]?.code ?? l.skuId) : null,
          confidence: l.confidence,
          alternatives: l.alternativeSkuIds.map((id) => c.skus[id]?.code ?? id),
        })),
      );
    }
    return allOk;
  } finally {
    await db.$disconnect();
  }
}

async function main(): Promise<number> {
  if (offline) {
    // Prove nothing leaves the machine in offline mode.
    globalThis.fetch = (async () => {
      throw new Error("Network is disabled in --offline mode");
    }) as typeof fetch;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_VIA_PROXY;
    out("Offline mode: no network, no key; the deterministic offline parser handles every order.");
    return (await captureOrders()) ? 0 : 1;
  }
  if (!key) {
    out("GEMINI_API_KEY is not set (environment or .env). Nothing was called.");
    return 2;
  }
  // The live check must use the key given here, not a proxy-injected one.
  delete process.env.GEMINI_VIA_PROXY;
  const userModel = process.env.GEMINI_MODEL?.trim() || undefined;
  installCallBudget();
  out(`Live mode: key present (value not shown). Call budget: ${MAX_API_CALLS}.`);
  try {
    if (!(await listModelsAndPick(userModel))) return 4;
    out(`  App code will use: ${geminiModels().join(" -> ")}`);
    await tinyPrompt();
  } catch (err) {
    if (err instanceof ApiError) {
      out(`\nGemini API error: HTTP ${err.status}${err.apiStatus ? ` ${err.apiStatus}` : ""}: ${err.message}`);
      if (isQuotaBillingOrPermission(err)) {
        out("Quota, billing or permission problem: stopping. The offline parser stays the documented path.");
        return 3;
      }
      return 1;
    }
    throw err;
  }
  const ok = await captureOrders();
  if (!ok) {
    out("\nAt least one order was not read by Gemini (see FAILED above; HTTP 401/403/429 mean permission or quota).");
    return 3;
  }
  out(`\nAll orders were read through the live Gemini path (model ${runModel}). API calls used: ${apiCalls}/${MAX_API_CALLS}.`);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(scrub(`Unexpected error: ${(err as Error).message}`));
    process.exitCode = 1;
  });
