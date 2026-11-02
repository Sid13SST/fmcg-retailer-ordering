/**
 * Map a retailer's product words ("biscuit chhota", "chai patti 250 wala") to SKUs.
 *
 * Evidence, strongest first:
 *  1. this retailer's own aliases (incl. ones learned from past corrections)
 *  2. distributor-wide aliases
 *  3. fuzzy match on SKU name + category (Levenshtein on normalized tokens, with a
 *     small Hinglish glossary: chai -> tea, sabun -> soap, ...)
 * plus small adjustments for pack size agreement ("250", "1 kilo"), the AI's own
 * sku_guess (Gemini only) and how often this retailer ordered the SKU before.
 *
 * CONFIDENCE IS A HEURISTIC, NOT A PROBABILITY. The buckets below are hand-tuned
 * thresholds on an additive score; they are not calibrated against real outcomes and
 * must not be read as "90% likely". The UI tooltip says the same.
 */
import { FILLER_WORDS, MEASURE_WORDS, normalizeText, similarity, unitOf } from "./hinglish";

export type Confidence = "high" | "medium" | "low";
export type AliasSourceId = "CURATED" | "CONFIRMED" | "CORRECTED";

export interface MatchSku {
  id: string;
  code: string;
  name: string;
  brand: string;
  category: string;
  caseSize: number;
  stockCases: number;
}

export interface MatchAlias {
  phrase: string;
  skuId: string;
  /** null = distributor-wide. */
  retailerId: string | null;
  usageCount: number;
  source: AliasSourceId;
}

export interface MatchContext {
  skus: readonly MatchSku[];
  /** Aliases visible to this retailer: their own plus distributor-wide. */
  aliases: readonly MatchAlias[];
  retailerId: string;
  /** Order lines per SKU in this retailer's history. */
  pastOrderCounts: ReadonlyMap<string, number>;
}

export type Evidence = "RETAILER_ALIAS" | "ALIAS" | "NAME" | "AI_GUESS" | "NONE";

export interface Candidate {
  skuId: string;
  code: string;
  score: number;
  evidence: Evidence;
  aliasPhrase: string | null;
  aliasSource: AliasSourceId | null;
}

export interface MatchResult {
  best: Candidate | null;
  confidence: Confidence | null;
  /** Exactly two when a best match and any plausible alternative exist; else up to two suggestions or none. */
  alternatives: Candidate[];
  /** Set when the match came from an alias this retailer taught us by confirming/correcting. */
  learned: { phrase: string; source: "CONFIRMED" | "CORRECTED" } | null;
}

// --- tunable heuristic constants (documented in ASSUMPTIONS.md A14) ---
export const MATCH_THRESHOLDS = {
  /** Minimum score to propose a SKU at all; below this the line is "could not match". */
  minBest: 0.5,
  /** Minimum score for an alternative to count as plausible. */
  minAlternative: 0.2,
  high: 0.85,
  medium: 0.65,
  /** "high" also needs this lead over the runner-up, so ambiguous words drop to medium. */
  highMargin: 0.2,
} as const;

const W = {
  retailerAliasExact: 1.0,
  retailerAliasFuzzy: 0.9,
  aliasExact: 0.92,
  aliasFuzzy: 0.8,
  name: 0.9,
  sizeAgree: 0.12,
  sizeConflict: -0.25,
  aiGuess: 0.2,
  history: 0.08,
};

/** Hinglish / Devanagari words mapped to the catalogue's English vocabulary. */
const GLOSSARY: Readonly<Record<string, string>> = {
  chai: "tea", chay: "tea", चाय: "tea", patti: "leaf", pati: "leaf", patta: "leaf", पत्ती: "leaf",
  biskut: "biscuit", biskit: "biscuit", biscut: "biscuit", बिस्कुट: "biscuit",
  washing: "detergent", surf: "detergent", sarf: "detergent", सर्फ: "detergent",
  sabun: "soap", साबुन: "soap", nahane: "bathing", bartan: "dishwash", manjan: "toothpaste", paste: "toothpaste",
  tel: "oil", nariyal: "coconut", namkeen: "bhujia", नमकीन: "bhujia", kaafi: "coffee", kofi: "coffee",
  phinyl: "phenyl", finyl: "phenyl", ponchha: "floor", toast: "rusk", noodle: "noodles", talc: "talcum",
};

const SIZE_UNIT_GRAMS: Readonly<Record<string, number>> = {
  g: 1, gm: 1, gms: 1, gram: 1, grams: 1, ग्राम: 1, kg: 1000, kgs: 1000, kilo: 1000, kilos: 1000, किलो: 1000,
  ml: 1, l: 1000, ltr: 1000, litre: 1000, liter: 1000,
};

interface Words {
  words: string[];
  /** Pack sizes in g/ml; a bare number ("250 wala") is kept as-is. */
  sizes: number[];
  key: string;
}

/** Normalize product words: drop filler/unit words, map glossary, pull out pack sizes. */
export function productWords(text: string): Words {
  const tokens = normalizeText(text).split(" ").filter(Boolean);
  const words: string[] = [];
  const sizes: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const next = tokens[i + 1];
    if (t === "aadha" && next && SIZE_UNIT_GRAMS[next] === 1000) {
      sizes.push(500);
      i++;
      continue;
    }
    if (/^\d+$/.test(t)) {
      const mult = next ? SIZE_UNIT_GRAMS[next] : undefined;
      sizes.push(Number(t) * (mult ?? 1));
      if (mult !== undefined) i++;
      continue;
    }
    if (FILLER_WORDS.has(t) || unitOf(t) || MEASURE_WORDS.has(t)) continue;
    words.push(GLOSSARY[t] ?? t);
  }
  return { words, sizes, key: [...words, ...sizes.map(String)].join(" ") };
}

function tokenSim(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 4 || b.length < 4) return 0; // short words must match exactly
  const s = similarity(a, b);
  return s >= 0.75 ? s : 0;
}

/** Share of `from` words found (fuzzily) in `to`. */
function coverage(from: readonly string[], to: readonly string[]): number {
  if (from.length === 0) return 0;
  return from.reduce((acc, f) => acc + Math.max(0, ...to.map((t) => tokenSim(f, t))), 0) / from.length;
}

function sizeAdjust(query: Words, target: Words): number {
  if (query.sizes.length === 0 || target.sizes.length === 0) return 0;
  return query.sizes.some((q) => target.sizes.includes(q)) ? W.sizeAgree : W.sizeConflict;
}

function skuWords(sku: MatchSku): Words {
  const w = productWords(`${sku.name} ${sku.category}`);
  return { ...w, words: [...new Set(w.words)] };
}

/** Score every SKU for the given words. Exported for tests and debugging. */
export function scoreCandidates(productText: string, ctx: MatchContext, skuGuess: string | null = null): Candidate[] {
  const query = productWords(productText);
  const maxHistory = Math.max(0, ...ctx.pastOrderCounts.values());
  const aliasWords = ctx.aliases.map((a) => ({ alias: a, words: productWords(a.phrase) }));

  return ctx.skus.map((sku) => {
    const target = skuWords(sku);
    let score = 0;
    let evidence: Evidence = "NONE";
    let aliasPhrase: string | null = null;
    let aliasSource: AliasSourceId | null = null;

    if (query.words.length > 0 || query.sizes.length > 0) {
      // Name / category fuzzy match.
      const nameScore = (0.75 * coverage(query.words, target.words) + 0.25 * coverage(target.words, query.words)) * W.name;
      if (nameScore > 0) {
        score = nameScore;
        evidence = "NAME";
      }
      // Aliases for this SKU (retailer-specific outrank distributor-wide).
      for (const { alias, words } of aliasWords) {
        if (alias.skuId !== sku.id || words.key.length === 0) continue;
        const own = alias.retailerId === ctx.retailerId;
        const exact = words.key === query.key;
        const fuzzy = (coverage(query.words, words.words) + coverage(words.words, query.words)) / 2;
        const s = exact
          ? own ? W.retailerAliasExact : W.aliasExact
          : fuzzy * (own ? W.retailerAliasFuzzy : W.aliasFuzzy);
        if (s > score) {
          score = s;
          evidence = own ? "RETAILER_ALIAS" : "ALIAS";
          aliasPhrase = alias.phrase;
          aliasSource = alias.source;
        }
      }
      if (score > 0) score += sizeAdjust(query, target);
    }
    if (skuGuess && skuGuess === sku.code) {
      score += W.aiGuess;
      if (evidence === "NONE") evidence = "AI_GUESS";
    }
    const history = ctx.pastOrderCounts.get(sku.id) ?? 0;
    if (score > 0 && history > 0 && maxHistory > 0) score += W.history * (Math.log1p(history) / Math.log1p(maxHistory));

    return { skuId: sku.id, code: sku.code, score: Math.max(0, Math.round(score * 1000) / 1000), evidence, aliasPhrase, aliasSource };
  });
}

/**
 * Order: score, then in-stock before out-of-stock, then same category, then same
 * brand as the best match, then this retailer's order history, then code (stable).
 */
function rank(cands: Candidate[], ctx: MatchContext, best: MatchSku | null): Candidate[] {
  const sku = new Map(ctx.skus.map((s) => [s.id, s]));
  return [...cands].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const sa = sku.get(a.skuId)!;
    const sb = sku.get(b.skuId)!;
    const stock = Number(sb.stockCases > 0) - Number(sa.stockCases > 0);
    if (stock) return stock;
    if (best) {
      const cat = Number(sb.category === best.category) - Number(sa.category === best.category);
      if (cat) return cat;
      const brand = Number(sb.brand === best.brand) - Number(sa.brand === best.brand);
      if (brand) return brand;
    }
    const hist = (ctx.pastOrderCounts.get(b.skuId) ?? 0) - (ctx.pastOrderCounts.get(a.skuId) ?? 0);
    if (hist) return hist;
    return a.code.localeCompare(b.code);
  });
}

export function confidenceFor(best: number, runnerUp: number): Confidence {
  const t = MATCH_THRESHOLDS;
  if (best >= t.high && best - runnerUp >= t.highMargin) return "high";
  if (best >= t.medium) return "medium";
  return "low";
}

export function matchPhrase(productText: string, ctx: MatchContext, skuGuess: string | null = null): MatchResult {
  const ranked = rank(scoreCandidates(productText, ctx, skuGuess), ctx, null);
  const top = ranked[0];
  if (!top || top.score < MATCH_THRESHOLDS.minBest) {
    return {
      best: null,
      confidence: null,
      alternatives: ranked.filter((c) => c.score >= MATCH_THRESHOLDS.minAlternative).slice(0, 2),
      learned: null,
    };
  }
  const bestSku = ctx.skus.find((s) => s.id === top.skuId) ?? null;
  const others = rank(ranked.slice(1), ctx, bestSku);
  const plausible = others.some((c) => c.score >= MATCH_THRESHOLDS.minAlternative);
  // When fewer than two alternatives scored, pad only with related items (same
  // category or brand family), never with an unrelated SKU.
  const related = (c: Candidate) => {
    const s = ctx.skus.find((x) => x.id === c.skuId);
    return c.score > 0 || (!!s && !!bestSku && (s.category === bestSku.category || s.brand === bestSku.brand));
  };
  const learned =
    top.evidence === "RETAILER_ALIAS" && top.aliasPhrase && (top.aliasSource === "CONFIRMED" || top.aliasSource === "CORRECTED")
      ? { phrase: top.aliasPhrase, source: top.aliasSource }
      : null;
  return {
    best: top,
    confidence: confidenceFor(top.score, others[0]?.score ?? 0),
    alternatives: plausible ? others.filter(related).slice(0, 2) : [],
    learned,
  };
}

/** The phrase stored when a retailer confirms or corrects a line (normalized, product words only). */
export function aliasPhraseFor(productText: string): string | null {
  const phrase = normalizeText(productText).split(" ").filter((t) => t && !FILLER_WORDS.has(t) && !unitOf(t)).join(" ");
  return phrase.length >= 2 && phrase.length <= 80 ? phrase : null;
}
