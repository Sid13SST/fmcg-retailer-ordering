/**
 * Seed data for Kirana OrderDesk (Jabalpur FMCG distributor).
 * Deterministic: re-running produces the same catalogue, people and order history
 * (dates are relative to "now"). Brands are fictional.
 *
 * Run: npx prisma db seed   (also runs automatically after `prisma migrate dev/reset`)
 */
import { PrismaClient, type OrderStatus } from "@prisma/client";
import { priceLine, type SchemeForPricing } from "../lib/scheme-engine";
import { computeOrderTotals, decideCredit } from "../lib/pricing";
import {
  ALIASES,
  BRIEF_SAMPLE_SKUS,
  DESK_USERS,
  RETAILERS,
  SALESMEN,
  SCHEMES,
  SKUS,
  type SkuSeed,
} from "./seed-data";

const prisma = new PrismaClient();

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

/** Plausible status trail for a seeded order: placed by the retailer, then desk action if any. */
function statusHistory(status: OrderStatus, createdAt: Date, holdReason: string | null) {
  const later = (hours: number) => new Date(createdAt.getTime() + hours * 60 * 60 * 1000);
  if (status === "DRAFT") {
    return [{ fromStatus: null, toStatus: "DRAFT" as const, actorRole: "RETAILER" as const, note: "Captured from WhatsApp text", createdAt }];
  }
  const placedAs: OrderStatus = status === "ON_HOLD" ? "ON_HOLD" : "PENDING_DESK_REVIEW";
  const events: Array<{ fromStatus: OrderStatus | null; toStatus: OrderStatus; actorRole: "RETAILER" | "ORDER_DESK"; note: string | null; createdAt: Date }> = [
    { fromStatus: null, toStatus: placedAs, actorRole: "RETAILER", note: holdReason, createdAt },
  ];
  if (status === "CONFIRMED") {
    events.push({ fromStatus: placedAs, toStatus: "CONFIRMED", actorRole: "ORDER_DESK", note: null, createdAt: later(14) });
  } else if (status === "REJECTED") {
    events.push({ fromStatus: placedAs, toStatus: "REJECTED", actorRole: "ORDER_DESK", note: "Duplicate of an order placed via salesman", createdAt: later(15) });
  }
  return events;
}

async function main() {
  assertBriefSamplesVerbatim();

  // Clear in dependency order so the seed is re-runnable.
  await prisma.tallyExport.deleteMany();
  await prisma.orderStatusEvent.deleteMany();
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
            skuCode: l.skuCode,
            skuName: skuOf(l.skuCode).seed.name,
            caseSize: skuOf(l.skuCode).seed.caseSize,
            gstRatePercent: l.gstRatePercent,
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
        statusEvents: { create: statusHistory(status, createdAt, holdReason) },
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
    statusEvents: await prisma.orderStatusEvent.count(),
  };
  console.log("Seeded Kirana OrderDesk:", counts);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
