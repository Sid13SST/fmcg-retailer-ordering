/**
 * Live smoke test of the Gemini extraction path on the brief's sample message.
 *
 *   GEMINI_API_KEY=... npx tsx scripts/gemini-smoke.ts     (key read from env / .env, sent as a header)
 *   GEMINI_VIA_PROXY=1 npx tsx scripts/gemini-smoke.ts     (no key header; an egress proxy injects it)
 *
 * Node's built-in fetch ignores HTTPS_PROXY; behind an HTTP proxy add NODE_USE_ENV_PROXY=1 (Node >= 22.21).
 *
 * Prints the HTTP status of each model call and the validated JSON. Never prints the key.
 */
import { GeminiProvider, engineMode, geminiModels } from "../lib/ai-capture";
import { SKUS, BRIEF_SAMPLE_ORDER_MESSAGE } from "../prisma/seed-data";

async function main() {
  const mode = engineMode();
  if (mode === "OFFLINE") {
    console.error("Neither GEMINI_API_KEY nor GEMINI_VIA_PROXY=1 is set; nothing to test.");
    process.exitCode = 2;
    return;
  }
  const loggingFetch: typeof fetch = async (input, init) => {
    const res = await fetch(input, init);
    const model = String(input).split("/models/")[1]?.split(":")[0];
    console.log(`POST ${model} -> HTTP ${res.status}`);
    return res;
  };
  const provider = new GeminiProvider({
    apiKey: mode === "GEMINI_KEY" ? process.env.GEMINI_API_KEY : undefined,
    fetchImpl: loggingFetch,
    models: geminiModels(),
    timeoutMs: 60_000,
  });
  console.log(`Mode: ${mode}. Message: ${BRIEF_SAMPLE_ORDER_MESSAGE}`);
  const result = await provider.extract(
    BRIEF_SAMPLE_ORDER_MESSAGE,
    SKUS.map((s) => ({ code: s.code, name: s.name, brand: s.brand })),
  );
  console.log(`Model used: ${result.model}; calls: ${result.calls}`);
  console.log("Validated AI JSON:", JSON.stringify(result.aiRaw, null, 2));
  console.log("Lines after cross-check:", JSON.stringify(result.lines.map((l) => ({ raw: l.rawPhrase, product: l.productText, qty: l.qty, unit: l.unit, guess: l.skuGuess, notes: l.notes })), null, 2));
}

main().catch((err: Error) => {
  console.error(`${err.name}: ${err.message}`);
  process.exitCode = 1;
});
