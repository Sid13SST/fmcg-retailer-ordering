/**
 * Static seed data: the catalogue (incl. the three brief samples verbatim), schemes,
 * people and curated aliases. Importable without side effects, so tests can use the
 * real catalogue; prisma/seed.ts writes it to the database.
 */
import type { SchemeType } from "@prisma/client";

// ---------------------------------------------------------------------------
// Sample SKUs from the client brief, verbatim. The structured rows below are
// checked against these strings at seed time so they can never drift.
// ---------------------------------------------------------------------------
export const BRIEF_SAMPLE_SKUS = [
  "SKU-BS-075 | Glucose biscuit 75 g, case of 96 | dealer price Rs 8.10 | stock 340 cases | scheme: Buy 10 cases get 1 free",
  "SKU-DT-1KG | Detergent powder 1 kg, case of 20 | Rs 101.50 | 85 cases | scheme: 3% off on 5 or more cases",
  "SKU-TE-250 | Tea leaf 250 g, case of 40 | Rs 118.00 | 0 cases (out of stock) | no scheme",
] as const;

/** Sample raw order message from the brief (used by AI order capture). */
export const BRIEF_SAMPLE_ORDER_MESSAGE =
  "bhaiya 5 peti biscuit chhota, 2 peti washing powder 1 kilo, chai patti 250 wala 1 peti";


export type SkuSeed = {
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

export const NARMADA = "Narmada Foods";
export const SHUBH = "Shubh Home Care";
export const SATPURA = "Satpura Beverages";
export const REWA = "Rewa Personal Care";

// GST rates are illustrative per category (see README) and stored per SKU.
export const SKUS: SkuSeed[] = [
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

export type SchemeSeed = {
  code: string;
  type: SchemeType;
  threshold: number;
  free?: number;
  percentOff?: number;
  active?: boolean;
};

export const SCHEMES: SchemeSeed[] = [
  { code: "SKU-BS-075", type: "BUY_X_GET_Y_FREE", threshold: 10, free: 1 },
  { code: "SKU-DT-1KG", type: "SLAB_PERCENT_OFF", threshold: 5, percentOff: 3 },
  { code: "SKU-ND-070", type: "BUY_X_GET_Y_FREE", threshold: 20, free: 2 },
  { code: "SKU-SP-100", type: "BUY_X_GET_Y_FREE", threshold: 6, free: 1 },
  { code: "SKU-TP-100", type: "SLAB_PERCENT_OFF", threshold: 10, percentOff: 5 },
  { code: "SKU-TE-500", type: "SLAB_PERCENT_OFF", threshold: 3, percentOff: 2.5 },
  // An expired scheme, kept for history; inactive schemes are ignored by the engine.
  { code: "SKU-HO-200", type: "SLAB_PERCENT_OFF", threshold: 4, percentOff: 4, active: false },
];

export const SALESMEN = [
  { key: "manoj", name: "Manoj Dubey", phone: "9425100001", beat: "Napier Town – Wright Town – Sadar" },
  { key: "santosh", name: "Santosh Rajak", phone: "9425100002", beat: "Gorakhpur – Garha – Madan Mahal" },
  { key: "arvind", name: "Arvind Thakur", phone: "9425100003", beat: "Adhartal – Ranjhi – Vijay Nagar – Ghamapur" },
] as const;

export const DESK_USERS = [
  { name: "Neha Sharma", phone: "9000000001" },
  { name: "Rohit Verma", phone: "9000000002" },
];

export type RetailerSeed = {
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

export const RETAILERS: RetailerSeed[] = [
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
export const ALIASES: Array<{ phrase: string; code: string; retailer: string | null; uses: number }> = [
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
  // Devanagari spellings, so the catalogue search works in Hindi script too.
  { phrase: "बिस्कुट", code: "SKU-BS-075", retailer: null, uses: 3 },
  { phrase: "सर्फ पाउडर", code: "SKU-DT-1KG", retailer: null, uses: 2 },
  { phrase: "चाय पत्ती", code: "SKU-TE-250", retailer: null, uses: 3 },
  { phrase: "साबुन", code: "SKU-SP-100", retailer: null, uses: 2 },
  { phrase: "नमकीन", code: "SKU-NM-200", retailer: null, uses: 2 },
];
