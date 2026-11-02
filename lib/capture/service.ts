/**
 * Server-side capture flow: read text with the configured engine, match SKUs, store
 * the AICapture record; later confirm it into a real order through the same
 * transactional pipeline as catalogue checkout, learning aliases on the way.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  AiExtractionError,
  ENGINE_LABEL,
  engineKind,
  type EngineKind,
  selectProvider,
  type CaptureEngineId,
  type ExtractionProvider,
} from "@/lib/ai-capture";
import { placeOrderInputSchema } from "@/lib/orders/cart-schema";
import { createRetailerOrder, type CreateOrderResult } from "@/lib/orders/create-order";
import type { Db } from "@/lib/orders/quote";
import { aliasPhraseFor, type MatchContext } from "@/lib/sku-matcher";
import type { ConfirmCaptureInput } from "./confirm-schema";
import { buildCaptureLines, type CaptureLine } from "./pipeline";
import { systemNote } from "@/lib/orders/system-notes";

export interface SkuOption {
  id: string;
  code: string;
  name: string;
  brand: string;
  category: string;
  caseSize: number;
  stockCases: number;
  imageEmoji: string | null;
  dealerPricePerCasePaise: number;
}

export interface CaptureView {
  captureId: string;
  engine: CaptureEngineId;
  /** Honest, user-facing label of what read the message. */
  engineLabel: string;
  engineKind: EngineKind;
  model: string | null;
  rawText: string;
  lines: CaptureLine[];
  /** Display data for every SKU referenced by the lines. */
  skus: Record<string, SkuOption>;
}

export type ParseResult =
  | { ok: true; capture: CaptureView }
  | { ok: false; code: "AI_FAILED"; captureId: string; message: string; engineLabel: string; engineKind: EngineKind };

const SKU_OPTION_SELECT = {
  id: true,
  code: true,
  name: true,
  brand: true,
  category: true,
  caseSize: true,
  stockCases: true,
  imageEmoji: true,
  dealerPricePerCasePaise: true,
} as const;

/** Window of past orders used for the history signal in matching. */
const HISTORY_DAYS = 90;

export async function loadMatchContext(db: Db, retailerId: string): Promise<{ ctx: MatchContext; skus: SkuOption[] }> {
  const since = new Date(Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000);
  const [skus, aliases, history] = await Promise.all([
    db.sKU.findMany({ where: { active: true }, select: SKU_OPTION_SELECT, orderBy: { code: "asc" } }),
    db.alias.findMany({
      where: { OR: [{ retailerId: null }, { retailerId }], sku: { active: true } },
      select: { phrase: true, skuId: true, retailerId: true, usageCount: true, source: true },
    }),
    db.orderLine.groupBy({
      by: ["skuId"],
      where: { order: { retailerId, createdAt: { gte: since }, status: { not: "REJECTED" } } },
      _count: { _all: true },
    }),
  ]);
  return {
    skus,
    ctx: {
      skus,
      aliases,
      retailerId,
      pastOrderCounts: new Map(history.map((h) => [h.skuId, h._count._all])),
    },
  };
}

function engineLabel(engine: CaptureEngineId, forcedOffline: boolean): string {
  if (engine === "OFFLINE" && forcedOffline) return "Offline parser - AI not used for this message";
  return ENGINE_LABEL[engine];
}

export async function parseCapture(
  db: PrismaClient,
  retailerId: string,
  text: string,
  opts: { forceOffline?: boolean; provider?: ExtractionProvider } = {},
): Promise<ParseResult> {
  const provider = opts.provider ?? selectProvider(process.env, { forceOffline: opts.forceOffline });
  const forced = !!opts.forceOffline;
  const { ctx, skus } = await loadMatchContext(db, retailerId);

  try {
    const extraction = await provider.extract(text, skus.map((s) => ({ code: s.code, name: s.name, brand: s.brand })));
    // The AI's sku_guess is a code; the matcher compares codes, so nothing else to map.
    const lines = buildCaptureLines(extraction.lines, ctx);
    const record = await db.aICapture.create({
      data: {
        retailerId,
        rawText: text,
        status: "PARSED",
        engine: extraction.engine,
        model: extraction.model,
        parsedJson: JSON.stringify({
          engine: extraction.engine,
          model: extraction.model,
          calls: extraction.calls,
          aiRaw: extraction.aiRaw,
          extracted: extraction.lines,
          lines,
        }),
      },
    });
    const byId = new Map(skus.map((s) => [s.id, s]));
    const referenced: Record<string, SkuOption> = {};
    for (const l of lines) {
      for (const id of [l.skuId, ...l.alternativeSkuIds]) {
        const s = id ? byId.get(id) : undefined;
        if (s) referenced[s.id] = s;
      }
    }
    return {
      ok: true,
      capture: {
        captureId: record.id,
        engine: extraction.engine,
        engineLabel: engineLabel(extraction.engine, forced),
        engineKind: engineKind(extraction.engine, forced),
        model: extraction.model,
        rawText: text,
        lines,
        skus: referenced,
      },
    };
  } catch (err) {
    if (!(err instanceof AiExtractionError)) throw err;
    // Fail honestly: record what happened, return no guessed lines.
    const record = await db.aICapture.create({
      data: { retailerId, rawText: text, status: "FAILED", engine: provider.engine, errorMessage: err.message },
    });
    return { ok: false, code: "AI_FAILED", captureId: record.id, message: err.message, engineLabel: ENGINE_LABEL[provider.engine], engineKind: engineKind(provider.engine, forced) };
  }
}

export type ConfirmResult =
  | CreateOrderResult
  | { ok: false; code: "CAPTURE_NOT_FOUND" | "CAPTURE_CLOSED"; message: string }
  | { ok: false; code: "INCOMPLETE_REVIEW"; message: string; lineIds: string[] };

interface StoredParsed {
  lines: CaptureLine[];
  engine: CaptureEngineId;
}

/**
 * Turn a reviewed capture into an order. Hard rules enforced here, not only in the UI:
 * every parsed line is either confirmed or explicitly removed, and every line with an
 * unclear unit carries the retailer's unit choice.
 */
export async function confirmCapture(
  db: PrismaClient,
  retailerId: string,
  captureId: string,
  input: ConfirmCaptureInput,
): Promise<ConfirmResult> {
  const capture = await db.aICapture.findUnique({ where: { id: captureId } });
  if (!capture || capture.retailerId !== retailerId || !capture.parsedJson) {
    return { ok: false, code: "CAPTURE_NOT_FOUND", message: "This text order was not found." };
  }
  const parsed = JSON.parse(capture.parsedJson) as StoredParsed;
  const parsedById = new Map(parsed.lines.map((l) => [l.id, l]));

  if (capture.status !== "PARSED") {
    // A retried request (same clientRequestId) for a confirmed capture returns the same
    // order; createRetailerOrder short-circuits on the existing idempotency key.
    if (capture.status === "CONFIRMED" && capture.confirmedOrderId) {
      const prior = await db.order.findUnique({ where: { clientRequestId: input.clientRequestId }, select: { id: true } });
      if (prior?.id === capture.confirmedOrderId) return createRetailerOrder(db, retailerId, toOrderInput(input));
    }
    return CLOSED;
  }

  const confirmedIds = new Set(input.lines.map((l) => l.lineId));
  const removed = new Set(input.removedLineIds);
  const unknownIds = [...confirmedIds, ...removed].filter((id) => !parsedById.has(id));
  const unaccounted = parsed.lines.filter((l) => !confirmedIds.has(l.id) && !removed.has(l.id)).map((l) => l.id);
  const unitMissing = input.lines.filter((l) => parsedById.get(l.lineId)?.needsUnitChoice && !l.unitChoice).map((l) => l.lineId);
  const bad = [...unknownIds, ...unaccounted, ...unitMissing, ...input.lines.filter((l) => removed.has(l.lineId)).map((l) => l.lineId)];
  if (bad.length > 0 || confirmedIds.size !== input.lines.length) {
    return {
      ok: false,
      code: "INCOMPLETE_REVIEW",
      message: "Every line must be confirmed with a unit choice where asked, or removed.",
      lineIds: [...new Set(bad)],
    };
  }

  const outcome = input.lines.map((l) => {
    const p = parsedById.get(l.lineId)!;
    return {
      lineId: l.lineId,
      rawPhrase: p.rawPhrase,
      productText: p.productText,
      suggestedSkuId: p.skuId,
      chosenSkuId: l.skuId,
      corrected: p.skuId !== l.skuId,
      parsedQty: p.qty,
      parsedUnit: p.unit,
      qtyCases: l.qtyCases,
      unitChoice: l.unitChoice ?? "CASE",
    };
  });

  try {
    return await createRetailerOrder(db, retailerId, toOrderInput(input), {
      source: "AI_TEXT",
      note: systemNote.captured(capture.engine === "GEMINI" ? "GEMINI" : "OFFLINE"),
      onCreated: async (tx, order) => {
        // Claim the capture atomically so two confirmations cannot both win.
        const claimed = await tx.aICapture.updateMany({
          where: { id: capture.id, status: "PARSED" },
          data: {
            status: "CONFIRMED",
            confirmedOrderId: order.id,
            outcomeJson: JSON.stringify({ orderId: order.id, orderNumber: order.orderNumber, lines: outcome, removedLineIds: [...removed] }),
          },
        });
        if (claimed.count !== 1) throw new CaptureClaimedError();
        for (const o of outcome) await learnAlias(tx, retailerId, o.productText, o.chosenSkuId, o.corrected);
        await recordSourceWords(tx, order.id, outcome);
      },
    });
  } catch (err) {
    if (err instanceof CaptureClaimedError) return CLOSED;
    throw err;
  }
}

class CaptureClaimedError extends Error {}

/**
 * Keep the retailer's original words on each order line so the desk can review the
 * mapping. Two text lines confirmed as the same SKU are merged into one order line
 * (cart rule), so their words are joined.
 */
async function recordSourceWords(
  tx: Prisma.TransactionClient,
  orderId: string,
  outcome: Array<{ chosenSkuId: string; rawPhrase: string; productText: string }>,
): Promise<void> {
  const bySku = new Map<string, { raw: string[]; product: string[] }>();
  for (const o of outcome) {
    const entry = bySku.get(o.chosenSkuId) ?? { raw: [], product: [] };
    entry.raw.push(o.rawPhrase);
    entry.product.push(o.productText);
    bySku.set(o.chosenSkuId, entry);
  }
  for (const [skuId, words] of bySku) {
    await tx.orderLine.updateMany({
      where: { orderId, skuId },
      // The first phrase is the alias phrase used for desk corrections.
      data: { sourcePhrase: words.raw.join(" + "), sourceProductText: words.product[0] ?? null },
    });
  }
}

const CLOSED = { ok: false, code: "CAPTURE_CLOSED", message: "This text order was already confirmed or discarded." } as const;

function toOrderInput(input: ConfirmCaptureInput) {
  return placeOrderInputSchema.parse({
    lines: input.lines.map((l) => ({ skuId: l.skuId, qtyCases: l.qtyCases })),
    clientRequestId: input.clientRequestId,
    shortagePolicy: input.shortagePolicy,
  });
}

/**
 * Upsert the retailer's own alias phrase -> chosen SKU. A changed mapping is a
 * correction; a repeat confirmation just strengthens it. Curated retailer aliases
 * keep their curated source when confirmed.
 */
export async function learnAlias(
  tx: Prisma.TransactionClient,
  retailerId: string,
  productText: string,
  skuId: string,
  corrected: boolean,
): Promise<void> {
  const phrase = aliasPhraseFor(productText);
  if (!phrase) return;
  const existing = await tx.alias.findUnique({ where: { retailerId_phrase: { retailerId, phrase } } });
  if (!existing) {
    await tx.alias.create({ data: { retailerId, phrase, skuId, usageCount: 1, source: corrected ? "CORRECTED" : "CONFIRMED" } });
    return;
  }
  if (existing.skuId !== skuId) {
    await tx.alias.update({ where: { id: existing.id }, data: { skuId, usageCount: 1, source: "CORRECTED" } });
    return;
  }
  await tx.alias.update({
    where: { id: existing.id },
    data: { usageCount: { increment: 1 }, ...(corrected && existing.source !== "CURATED" ? { source: "CORRECTED" } : {}) },
  });
}

export async function discardCapture(db: PrismaClient, retailerId: string, captureId: string): Promise<boolean> {
  const res = await db.aICapture.updateMany({ where: { id: captureId, retailerId, status: "PARSED" }, data: { status: "DISCARDED" } });
  return res.count === 1;
}

/** Manual SKU search for lines that could not be matched (name, code, brand, aliases). */
export async function searchSkus(db: Db, retailerId: string, q: string, take = 8): Promise<SkuOption[]> {
  const term = q.trim().toLowerCase();
  if (!term) return [];
  return db.sKU.findMany({
    where: {
      active: true,
      OR: [
        { name: { contains: term } },
        { code: { contains: term.toUpperCase() } },
        { brand: { contains: term } },
        { category: { contains: term } },
        { aliases: { some: { AND: [{ OR: [{ retailerId: null }, { retailerId }] }, { phrase: { contains: term } }] } } },
      ],
    },
    select: SKU_OPTION_SELECT,
    orderBy: [{ stockCases: "desc" }, { name: "asc" }],
    take,
  });
}
