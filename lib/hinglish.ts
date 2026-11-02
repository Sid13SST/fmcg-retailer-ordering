/**
 * Deterministic text helpers for messy Hinglish order messages: normalization,
 * tokenization, Hindi/English number words, pack units and Levenshtein distance.
 * Pure functions, no I/O; shared by the offline parser and the SKU matcher.
 */

/** Lowercase, NFKC, Devanagari digits -> ASCII, punctuation -> spaces, collapse whitespace. */
export function normalizeText(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966))
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    // "5peti" -> "5 peti", "250g" -> "250 g" (digits glued to Latin letters)
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(input: string): string[] {
  const n = normalizeText(input);
  return n ? n.split(" ") : [];
}

/**
 * Number words retailers type. Only small counts: an order line is a handful of cases.
 * "do" (2) doubles as "give" in Hindi, so number words only count as a quantity when
 * followed by a pack unit or at the start of a line (see offline parser).
 */
export const NUMBER_WORDS: Readonly<Record<string, number>> = {
  // Hindi (Latin script), with common spellings
  ek: 1, aek: 1,
  do: 2, doh: 2,
  teen: 3, tin: 3,
  char: 4, chaar: 4, chār: 4,
  paanch: 5, panch: 5, paach: 5, pach: 5, panj: 5,
  chhe: 6, chhah: 6, chah: 6, che: 6, chhey: 6,
  saat: 7, sat: 7,
  aath: 8, ath: 8,
  nau: 9, no: 9,
  das: 10, dus: 10,
  gyarah: 11, gyaarah: 11,
  barah: 12, baarah: 12,
  pandrah: 15, pandra: 15,
  bees: 20, bis: 20,
  pachees: 25, pachchis: 25,
  tees: 30,
  pachaas: 50, pachas: 50,
  // Devanagari
  एक: 1, दो: 2, तीन: 3, चार: 4, पांच: 5, पाँच: 5, छह: 6, छः: 6, सात: 7, आठ: 8, नौ: 9, दस: 10, बीस: 20,
  // English
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, dozen: 12,
};

/** Words that are ambiguous as numbers in normal sentences ("no", "sat", "tin"). Never a quantity mid-line. */
const WEAK_NUMBER_WORDS = new Set(["no", "sat", "tin", "do", "bis", "ath", "che", "pach"]);

export function numberValue(token: string, { allowWeak }: { allowWeak: boolean }): number | null {
  if (/^\d{1,4}$/.test(token)) return Number(token);
  const n = NUMBER_WORDS[token];
  if (n === undefined) return null;
  if (!allowWeak && WEAK_NUMBER_WORDS.has(token)) return null;
  return n;
}

export type PackUnit = "CASE" | "PIECE";

/**
 * Pack-unit words. CASE words are unambiguous ("peti" is the trade word for a case).
 * PIECE words ("dabba", "packet", "piece") mean single retail units; orders are in
 * cases, so these always trigger a clarification question, never a guess.
 */
export const UNIT_WORDS: Readonly<Record<string, PackUnit>> = {
  peti: "CASE", petti: "CASE", pethi: "CASE", petiyan: "CASE", petiya: "CASE",
  case: "CASE", cases: "CASE", ces: "CASE", carton: "CASE", cartons: "CASE", cartoon: "CASE", ctn: "CASE",
  पेटी: "CASE", केस: "CASE",
  piece: "PIECE", pieces: "PIECE", pcs: "PIECE", pc: "PIECE", pis: "PIECE", nag: "PIECE",
  dabba: "PIECE", dabbe: "PIECE", dibba: "PIECE", dibbe: "PIECE", packet: "PIECE", packets: "PIECE",
  pkt: "PIECE", pack: "PIECE", pouch: "PIECE", bottle: "PIECE", bottles: "PIECE",
  डब्बा: "PIECE", डिब्बा: "PIECE", पैकेट: "PIECE", पीस: "PIECE",
};

export function unitOf(token: string | undefined): PackUnit | null {
  return token ? (UNIT_WORDS[token] ?? null) : null;
}

/** Words after a number that make it a pack size ("1 kilo", "250 wala"), not a quantity. */
export const MEASURE_WORDS = new Set([
  "g", "gm", "gms", "gram", "grams", "kg", "kgs", "kilo", "kilos", "ml", "l", "ltr", "litre", "liter",
  "wala", "wali", "wale", "waala", "waali", "ka", "ki", "ke", "rs", "rupaye", "rupees", "bags", "bag",
  "ग्राम", "किलो", "वाला", "वाली",
]);

/** Politeness and verbs that carry no product meaning. */
export const FILLER_WORDS = new Set([
  "bhaiya", "bhaiyya", "bhai", "bhayya", "ji", "sir", "please", "pls", "plz", "jaldi", "kal", "aaj",
  "bhej", "bhejo", "bhejna", "bhejiye", "dena", "dedo", "de", "dijiye", "chahiye", "chaiye", "order", "mujhe",
  "hamko", "humko", "hume", "aur", "and", "bhi", "send", "need", "namaste", "namaskar", "ram", "jai",
  "भैया", "भाई", "जी", "भेजो", "भेज", "देना", "चाहिए", "और",
]);

/** Classic Levenshtein edit distance (iterative, two rows). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length]!;
}

/** 1 = identical, 0 = nothing in common. */
export function similarity(a: string, b: string): number {
  if (!a && !b) return 1;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}
