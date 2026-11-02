/**
 * Seed data for Kirana OrderDesk (Jabalpur FMCG distributor).
 * Deterministic: re-running produces the same catalogue, people and order history
 * (dates are relative to "now"). Brands are fictional.
 *
 * Run: npx prisma db seed   (also runs automatically after `prisma migrate dev/reset`)
 */
import { PrismaClient, type OrderStatus, type SchemeType } from "@prisma/client";
import { priceLine, type SchemeForPricing } from "../lib/scheme-engine";
import { computeOrderTotals, decideCredit } from "../lib/pricing";

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Sample SKUs from the client brief, verbatim. The structured rows below are
// checked against these strings at seed time so they can never drift.
// ---------------------------------------------------------------------------
const BRIEF_SAMPLE_SKUS = [
  "SKU-BS-075 | Glucose biscuit 75 g, case of 96 | dealer price Rs 8.10 | stock 340 cases | scheme: Buy 10 cases get 1 free",
  "SKU-DT-1KG | Detergent powder 1 kg, case of 20 | Rs 101.50 | 85 cases | scheme: 3% off on 5 or more cases",
  "SKU-TE-250 | Tea leaf 250 g, case of 40 | Rs 118.00 | 0 cases (out of stock) | no scheme",
] as const;

/** Sample raw order message from the brief (used by AI order capture in a later chunk). */
export const BRIEF_SAMPLE_ORDER_MESSAGE =
  "bhaiya 5 peti biscuit chhota, 2 peti washing powder 1 kilo, chai patti 250 wala 1 peti";

// Deterministic PRNG (mulberry32) so the seed is reproducible.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261102);
const randInt = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
function pick<T>(items: readonly T[]): T {
  const item = items[Math.floor(rand() * items.length)];
  if (item === undefined) throw new Error("pick() from empty list");
  return item;
}

type SkuSeed = {
  code: string;
  name: string;
  brand: string;
  category: string;
  caseSize: number;
  pricePaise: number;
  gst: 5 | 12 | 18;
  stock: number;
  emoji: string;
};

const NARMADA = "Narmada Foods";
const SHUBH = "Shubh Home Care";
const SATPURA = "Satpura Beverages";
const REWA = "Rewa Personal Care";

// GST rates are illustrative per category (see README) and stored per SKU.
const SKUS: SkuSeed[] = [
  // Narmada Foods — biscuits & snacks
  { code: "SKU-BS-075", name: "Glucose biscuit 75 g", brand: NARMADA, category: "Biscuits", caseSize: 96, pricePaise: 810, gst: 18, stock: 340, emoji: "🍪" },
  { code: "SKU-BS-150", name: "Marie biscuit 150 g", brand: NARMADA, category: "Biscuits", caseSize: 60, pricePaise: 1890, gst: 18, stock: 210, emoji: "🍪" },
  { code: "SKU-CR-100", name: "Cream biscuit 100 g", brand: NARMADA, category: "Biscuits", caseSize: 72, pricePaise: 1720, gst: 18, stock: 160, emoji: "🍪" },
  { code: "SKU-RK-200", name: "Rusk toast 200 g", brand: NARMADA, category: "Bakery", caseSize: 40, pricePaise: 3150, gst: 5, stock: 95, emoji: "🍞" },
  { code: "SKU-NM-200", name: "Aloo bhujia 200 g", brand: NARMADA, category: "Namkeen", caseSize: 50, pricePaise: 4250, gst: 12, stock: 120, emoji: "🥨" },
  { code: "SKU-ND-070", name: "Masala instant noodles 70 g", brand: NARMADA, category: "Noodles", caseSize: 96, pricePaise: 1180, gst: 12, stock: 260, emoji: "🍜" },
  // Shubh Home Care — fabric & home care
  { code: "SKU-DT-1KG", name: "Detergent powder 1 kg", brand: SHUBH, category: "Detergent", caseSize: 20, pricePaise: 10150, gst: 18, stock: 85, emoji: "🧺" },
  { code: "SKU-DT-500", name: "Detergent powder 500 g", brand: SHUBH, category: "Detergent", caseSize: 40, pricePaise: 5250, gst: 18, stock: 140, emoji: "🧺" },
  { code: "SKU-DB-130", name: "Detergent bar 130 g", brand: SHUBH, category: "Detergent", caseSize: 100, pricePaise: 1000, gst: 18, stock: 300, emoji: "🧼" },
  { code: "SKU-DW-500", name: "Dishwash bar 500 g", brand: SHUBH, category: "Dishwash", caseSize: 36, pricePaise: 3800, gst: 18, stock: 75, emoji: "🍽️" },
  { code: "SKU-SP-100", name: "Bathing soap 100 g", brand: SHUBH, category: "Soap", caseSize: 72, pricePaise: 3150, gst: 18, stock: 180, emoji: "🧼" },
  { code: "SKU-PH-500", name: "Floor cleaner phenyl 500 ml", brand: SHUBH, category: "Home Care", caseSize: 24, pricePaise: 6200, gst: 18, stock: 12, emoji: "🧴" },
  // Satpura Beverages — tea & beverages
  { code: "SKU-TE-250", name: "Tea leaf 250 g", brand: SATPURA, category: "Tea", caseSize: 40, pricePaise: 11800, gst: 5, stock: 0, emoji: "🍵" },
  { code: "SKU-TE-500", name: "Tea leaf 500 g", brand: SATPURA, category: "Tea", caseSize: 24, pricePaise: 22900, gst: 5, stock: 48, emoji: "🍵" },
  { code: "SKU-TD-100", name: "Tea dust 100 g", brand: SATPURA, category: "Tea", caseSize: 100, pricePaise: 4600, gst: 5, stock: 150, emoji: "🍵" },
  { code: "SKU-CF-050", name: "Instant coffee 50 g", brand: SATPURA, category: "Coffee", caseSize: 48, pricePaise: 14500, gst: 18, stock: 36, emoji: "☕" },
  { code: "SKU-GT-025", name: "Green tea 25 bags", brand: SATPURA, category: "Tea", caseSize: 36, pricePaise: 9900, gst: 5, stock: 22, emoji: "🍵" },
  { code: "SKU-HD-500", name: "Malt health drink 500 g", brand: SATPURA, category: "Health Drinks", caseSize: 24, pricePaise: 24500, gst: 18, stock: 30, emoji: "🥛" },
  // Rewa Personal Care
  { code: "SKU-TP-100", name: "Toothpaste 100 g", brand: REWA, category: "Oral Care", caseSize: 72, pricePaise: 5400, gst: 18, stock: 110, emoji: "🪥" },
  { code: "SKU-TP-200", name: "Toothpaste 200 g", brand: REWA, category: "Oral Care", caseSize: 36, pricePaise: 10400, gst: 18, stock: 64, emoji: "🪥" },
  { code: "SKU-SH-180", name: "Shampoo 180 ml", brand: REWA, category: "Hair Care", caseSize: 48, pricePaise: 12900, gst: 18, stock: 40, emoji: "🧴" },
  { code: "SKU-SH-SAC", name: "Shampoo sachet strip of 16", brand: REWA, category: "Hair Care", caseSize: 60, pricePaise: 1450, gst: 18, stock: 220, emoji: "🧴" },
  { code: "SKU-HO-200", name: "Coconut hair oil 200 ml", brand: REWA, category: "Hair Care", caseSize: 48, pricePaise: 9200, gst: 18, stock: 58, emoji: "🥥" },
  { code: "SKU-TL-100", name: "Talcum powder 100 g", brand: REWA, category: "Skin Care", caseSize: 48, pricePaise: 7800, gst: 18, stock: 70, emoji: "🌸" },
];

type SchemeSeed = {
  code: string;
  type: SchemeType;
  threshold: number;
  free?: number;
  percentOff?: number;
  active?: boolean;
};

const SCHEMES: SchemeSeed[] = [
  { code: "SKU-BS-075", type: "BUY_X_GET_Y_FREE", threshold: 10, free: 1 },
  { code: "SKU-DT-1KG", type: "SLAB_PERCENT_OFF", threshold: 5, percentOff: 3 },
  { code: "SKU-ND-070", type: "BUY_X_GET_Y_FREE", threshold: 20, free: 2 },
  { code: "SKU-SP-100", type: "BUY_X_GET_Y_FREE", threshold: 6, free: 1 },
  { code: "SKU-TP-100", type: "SLAB_PERCENT_OFF", threshold: 10, percentOff: 5 },
  { code: "SKU-TE-500", type: "SLAB_PERCENT_OFF", threshold: 3, percentOff: 2.5 },
  // An expired scheme, kept for history; inactive schemes are ignored by the engine.
  { code: "SKU-HO-200", type: "SLAB_PERCENT_OFF", threshold: 4, percentOff: 4, active: false },
];

const SALESMEN = [
  { key: "manoj", name: "Manoj Dubey", phone: "9425100001", beat: "Napier Town – Wright Town – Sadar" },
  { key: "santosh", name: "Santosh Rajak", phone: "9425100002", beat: "Gorakhpur – Garha – Madan Mahal" },
  { key: "arvind", name: "Arvind Thakur", phone: "9425100003", beat: "Adhartal – Ranjhi – Vijay Nagar – Ghamapur" },
] as const;

const DESK_USERS = [
  { name: "Neha Sharma", phone: "9000000001" },
  { name: "Rohit Verma", phone: "9000000002" },
];

type RetailerSeed = {
  key: string;
  name: string;
  shopName: string;
  phone: string;
  area: string;
  limitRs: number;
  usedRs: number;
  salesman: (typeof SALESMEN)[number]["key"];
  favourites: string[];
};

const RETAILERS: RetailerSeed[] = [
  { key: "agrawal", name: "Ramesh Agrawal", shopName: "Agrawal Kirana Stores", phone: "9827000001", area: "Napier Town", limitRs: 50000, usedRs: 12000, salesman: "manoj", favourites: ["SKU-BS-075", "SKU-DT-1KG", "SKU-TE-250", "SKU-SP-100", "SKU-ND-070"] },
  { key: "jain", name: "Sunita Jain", shopName: "Jain General Store", phone: "9827000002", area: "Wright Town", limitRs: 75000, usedRs: 68500, salesman: "manoj", favourites: ["SKU-TP-200", "SKU-SH-180", "SKU-TE-500", "SKU-BS-150", "SKU-HD-500"] },
  { key: "irfan", name: "Mohd. Irfan", shopName: "Irfan Provision Store", phone: "9827000003", area: "Gorakhpur", limitRs: 30000, usedRs: 31200, salesman: "santosh", favourites: ["SKU-DB-130", "SKU-TD-100", "SKU-BS-075", "SKU-SH-SAC", "SKU-ND-070"] },
  { key: "yadav", name: "Pradeep Yadav", shopName: "Shri Ram Kirana", phone: "9827000004", area: "Adhartal", limitRs: 40000, usedRs: 5000, salesman: "arvind", favourites: ["SKU-BS-075", "SKU-NM-200", "SKU-DT-500", "SKU-TD-100", "SKU-DW-500"] },
  { key: "soni", name: "Kavita Soni", shopName: "Soni Kirana & General", phone: "9827000005", area: "Ranjhi", limitRs: 25000, usedRs: 0, salesman: "arvind", favourites: ["SKU-SH-SAC", "SKU-TL-100", "SKU-SP-100", "SKU-BS-150"] },
  { key: "patel", name: "Rajesh Patel", shopName: "Patel Super Bazaar", phone: "9827000006", area: "Vijay Nagar", limitRs: 150000, usedRs: 82000, salesman: "arvind", favourites: ["SKU-DT-1KG", "SKU-TP-100", "SKU-CF-050", "SKU-HO-200", "SKU-CR-100", "SKU-TE-500"] },
  { key: "tiwari", name: "Anil Tiwari", shopName: "Maa Narmada Traders", phone: "9827000007", area: "Garha", limitRs: 60000, usedRs: 59990, salesman: "santosh", favourites: ["SKU-DT-1KG", "SKU-DB-130", "SKU-BS-075", "SKU-RK-200"] },
  { key: "gupta", name: "Deepak Gupta", shopName: "Gupta Kirana Bhandar", phone: "9827000008", area: "Madan Mahal", limitRs: 35000, usedRs: 18000, salesman: "santosh", favourites: ["SKU-NM-200", "SKU-ND-070", "SKU-TE-250", "SKU-DW-500"] },
  { key: "khan", name: "Shabana Khan", shopName: "Khan Daily Needs", phone: "9827000009", area: "Ghamapur", limitRs: 20000, usedRs: 9500, salesman: "arvind", favourites: ["SKU-SH-SAC", "SKU-DB-130", "SKU-BS-075", "SKU-TD-100"] },
  { key: "chourasia", name: "Vikas Chourasia", shopName: "Chourasia Kirana Store", phone: "9827000010", area: "Sadar", limitRs: 45000, usedRs: 22000, salesman: "manoj", favourites: ["SKU-TP-100", "SKU-HO-200", "SKU-SP-100", "SKU-DT-500", "SKU-BS-075"] },
];

// Phrases retailers actually type. retailer = null -> distributor-wide alias.
const ALIASES: Array<{ phrase: string; code: string; retailer: string | null; uses: number }> = [
  { phrase: "peti biscuit", code: "SKU-BS-075", retailer: null, uses: 14 },
  { phrase: "biscuit chhota", code: "SKU-BS-075", retailer: null, uses: 9 },
  { phrase: "glucose biscuit", code: "SKU-BS-075", retailer: null, uses: 6 },
  { phrase: "washing powder 1 kilo", code: "SKU-DT-1KG", retailer: null, uses: 8 },
  { phrase: "kapde dhone ka powder", code: "SKU-DT-1KG", retailer: null, uses: 3 },
  { phrase: "chai patti 250 wala", code: "SKU-TE-250", retailer: null, uses: 7 },
  { phrase: "chai patti aadha kilo", code: "SKU-TE-500", retailer: null, uses: 4 },
  { phrase: "noodles masala", code: "SKU-ND-070", retailer: null, uses: 5 },
  { phrase: "bhujia", code: "SKU-NM-200", retailer: null, uses: 5 },
  { phrase: "kapde ka sabun", code: "SKU-DB-130", retailer: null, uses: 6 },
  { phrase: "bartan bar", code: "SKU-DW-500", retailer: null, uses: 3 },
  { phrase: "nahane ka sabun", code: "SKU-SP-100", retailer: null, uses: 4 },
  { phrase: "manjan chhota", code: "SKU-TP-100", retailer: null, uses: 3 },
  { phrase: "nariyal tel", code: "SKU-HO-200", retailer: null, uses: 2 },
  { phrase: "chhota biscuit", code: "SKU-BS-075", retailer: "agrawal", uses: 5 },
  { phrase: "bada paste", code: "SKU-TP-200", retailer: "jain", uses: 3 },
  { phrase: "shampoo pudiya", code: "SKU-SH-SAC", retailer: "khan", uses: 4 },
];

const ORDER_COUNT = 40;
const DAY_MS = 24 * 60 * 60 * 1000;

function assertBriefSamplesVerbatim() {
  for (const line of BRIEF_SAMPLE_SKUS) {
    const [code, description] = line.split(" | ");
    const sku = SKUS.find((s) => s.code === code);
    if (!sku || `${sku.name}, case of ${sku.caseSize}` !== description) {
      throw new Error(`Seed drifted from brief sample: ${line}`);
    }
  }
  const expect = (code: string, price: number, stock: number) => {
    const s = SKUS.find((x) => x.code === code);
    if (!s || s.pricePaise !== price || s.stock !== stock) throw new Error(`Seed drifted for ${code}`);
  };
  expect("SKU-BS-075", 810, 340);
  expect("SKU-DT-1KG", 10150, 85);
  expect("SKU-TE-250", 11800, 0);
  if (SCHEMES.some((s) => s.code === "SKU-TE-250")) throw new Error("SKU-TE-250 must have no scheme");
}

function statusForAge(daysAgo: number): OrderStatus {
  const r = rand();
  if (daysAgo <= 1) return r < 0.2 ? "DRAFT" : "PENDING_DESK_REVIEW";
  if (daysAgo <= 3) return r < 0.6 ? "PENDING_DESK_REVIEW" : "CONFIRMED";
  return r < 0.1 ? "REJECTED" : "CONFIRMED";
}

async function main() {
  assertBriefSamplesVerbatim();

  // Clear in dependency order so the seed is re-runnable.
  await prisma.tallyExport.deleteMany();
  await prisma.aICapture.deleteMany();
  await prisma.orderLine.deleteMany();
  await prisma.order.deleteMany();
  await prisma.alias.deleteMany();
  await prisma.retailerPriceOverride.deleteMany();
  await prisma.scheme.deleteMany();
  await prisma.sKU.deleteMany();
  await prisma.retailer.deleteMany();
  await prisma.salesman.deleteMany();
  await prisma.deskUser.deleteMany();

  const salesmanIds = new Map<string, string>();
  for (const s of SALESMEN) {
    const row = await prisma.salesman.create({ data: { name: s.name, phone: s.phone, beat: s.beat } });
    salesmanIds.set(s.key, row.id);
  }

  for (const d of DESK_USERS) await prisma.deskUser.create({ data: d });

  const retailerIds = new Map<string, string>();
  for (const r of RETAILERS) {
    const row = await prisma.retailer.create({
      data: {
        name: r.name,
        shopName: r.shopName,
        phone: r.phone,
        area: r.area,
        creditLimitPaise: r.limitRs * 100,
        creditUsedPaise: r.usedRs * 100,
        salesmanId: salesmanIds.get(r.salesman) ?? null,
      },
    });
    retailerIds.set(r.key, row.id);
  }

  const skuByCode = new Map<string, { id: string; seed: SkuSeed }>();
  for (const s of SKUS) {
    const row = await prisma.sKU.create({
      data: {
        code: s.code,
        name: s.name,
        brand: s.brand,
        category: s.category,
        caseSize: s.caseSize,
        dealerPricePerCasePaise: s.pricePaise,
        gstRatePercent: s.gst,
        stockCases: s.stock,
        imageEmoji: s.emoji,
      },
    });
    skuByCode.set(s.code, { id: row.id, seed: s });
  }
  const skuOf = (code: string) => {
    const s = skuByCode.get(code);
    if (!s) throw new Error(`Unknown SKU ${code}`);
    return s;
  };

  const activeSchemeBySku = new Map<string, SchemeForPricing>();
  for (const sc of SCHEMES) {
    const sku = skuOf(sc.code);
    const active = sc.active ?? true;
    if (active && activeSchemeBySku.has(sku.id)) throw new Error(`A3 violated: two active schemes on ${sc.code}`);
    const data = {
      skuId: sku.id,
      type: sc.type,
      thresholdCases: sc.threshold,
      freeCases: sc.free ?? 0,
      percentOff: sc.percentOff ?? 0,
      active,
    };
    await prisma.scheme.create({ data });
    if (active) activeSchemeBySku.set(sku.id, data);
  }

  for (const a of ALIASES) {
    await prisma.alias.create({
      data: {
        phrase: a.phrase,
        skuId: skuOf(a.code).id,
        retailerId: a.retailer ? (retailerIds.get(a.retailer) ?? null) : null,
        usageCount: a.uses,
      },
    });
  }

  // Past orders over the last 30 days, oldest first so order numbers are chronological.
  const now = Date.now();
  // Retailers at/near their credit limit with a fresh order, so the desk has holds to review.
  const holdProne = RETAILERS.filter((r) => ["irfan", "tiwari", "jain"].includes(r.key));
  const plans = [
    ...Array.from({ length: ORDER_COUNT - holdProne.length }, () => ({
      retailer: pick(RETAILERS),
      daysAgo: randInt(0, 29),
      minuteOfDay: randInt(8 * 60, 21 * 60),
      forceReview: false,
    })),
    ...holdProne.map((retailer, i) => ({ retailer, daysAgo: i, minuteOfDay: 10 * 60 + i * 47, forceReview: true })),
  ].sort((a, b) => b.daysAgo - a.daysAgo || a.minuteOfDay - b.minuteOfDay);

  const phraseFor = (code: string, retailerKey: string) =>
    ALIASES.find((a) => a.code === code && a.retailer === retailerKey)?.phrase ??
    ALIASES.find((a) => a.code === code && a.retailer === null)?.phrase ??
    skuOf(code).seed.name.toLowerCase();

  let seq = 0;
  for (const plan of plans) {
    seq += 1;
    const createdAt = new Date(now - plan.daysAgo * DAY_MS);
    createdAt.setHours(Math.floor(plan.minuteOfDay / 60), plan.minuteOfDay % 60, 0, 0);

    const lineCount = randInt(1, Math.min(4, plan.retailer.favourites.length));
    const codes = [...plan.retailer.favourites].sort(() => rand() - 0.5).slice(0, lineCount);
    const lines = codes.map((code) => {
      const sku = skuOf(code);
      const qty = pick([1, 2, 2, 3, 4, 5, 5, 6, 10, 12, 20]);
      // History is priced as it was then: ignore today's stock levels.
      return priceLine(
        { id: sku.id, code, caseSize: sku.seed.caseSize, dealerPricePerCasePaise: sku.seed.pricePaise, gstRatePercent: sku.seed.gst, stockCases: 100_000 },
        qty,
        activeSchemeBySku.get(sku.id) ?? null,
      );
    });
    const totals = computeOrderTotals(lines);

    const retailerId = retailerIds.get(plan.retailer.key);
    if (!retailerId) throw new Error("retailer missing");

    // Recent orders from retailers at/over their limit are on credit hold (A9).
    let status: OrderStatus = plan.forceReview ? "PENDING_DESK_REVIEW" : statusForAge(plan.daysAgo);
    let holdReason: string | null = null;
    let creditShortfallPaise: number | null = null;
    if (plan.daysAgo <= 3 && status === "PENDING_DESK_REVIEW") {
      const credit = decideCredit(
        { creditLimitPaise: plan.retailer.limitRs * 100, creditUsedPaise: plan.retailer.usedRs * 100 },
        totals.grandTotalPaise,
      );
      if (credit.decision === "ON_HOLD") {
        status = "ON_HOLD";
        holdReason = credit.reason;
        creditShortfallPaise = credit.shortfallPaise;
      }
    }

    const source = rand() < 0.35 ? "AI_TEXT" : "CATALOG";
    const order = await prisma.order.create({
      data: {
        orderNumber: `KOD-${String(seq).padStart(5, "0")}`,
        retailerId,
        status,
        source,
        createdByRole: "RETAILER",
        subtotalPaise: totals.subtotalPaise,
        discountPaise: totals.discountPaise,
        gstPaise: totals.gstPaise,
        grandTotalPaise: totals.grandTotalPaise,
        holdReason,
        creditShortfallPaise,
        createdAt,
        updatedAt: createdAt,
        lines: {
          create: lines.map((l) => ({
            skuId: l.skuId,
            qtyCases: l.qtyCases,
            unitPricePaise: l.unitPricePaise,
            freeCases: l.freeCases,
            discountPercent: l.discountPercent,
            discountPaise: l.discountPaise,
            subtotalPaise: l.subtotalPaise,
            gstPaise: l.gstPaise,
            totalPaise: l.totalPaise,
            schemeLabel: l.schemeLabel,
          })),
        },
      },
    });

    if (source === "AI_TEXT") {
      const rawText =
        "bhaiya " + lines.map((l) => `${l.qtyCases} peti ${phraseFor(l.skuCode, plan.retailer.key)}`).join(", ");
      await prisma.aICapture.create({
        data: {
          retailerId,
          rawText,
          parsedJson: JSON.stringify({
            lines: lines.map((l) => ({
              phrase: phraseFor(l.skuCode, plan.retailer.key),
              skuCode: l.skuCode,
              qtyCases: l.qtyCases,
            })),
          }),
          status: status === "DRAFT" ? "PARSED" : "CONFIRMED",
          confirmedOrderId: status === "DRAFT" ? null : order.id,
          createdAt,
          updatedAt: createdAt,
        },
      });
    }
  }

  const counts = {
    salesmen: await prisma.salesman.count(),
    deskUsers: await prisma.deskUser.count(),
    retailers: await prisma.retailer.count(),
    brands: new Set(SKUS.map((s) => s.brand)).size,
    skus: await prisma.sKU.count(),
    schemes: await prisma.scheme.count({ where: { active: true } }),
    orders: await prisma.order.count(),
    aiCaptures: await prisma.aICapture.count(),
    aliases: await prisma.alias.count(),
  };
  console.log("Seeded Kirana OrderDesk:", counts);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
