import type { MatchAlias, MatchContext } from "@/lib/sku-matcher";
import { ALIASES, SKUS } from "@/prisma/seed-data";

/** Matcher context built from the real seed catalogue; SKU ids are the codes. */
export function seedContext(
  opts: { retailerKey?: string; extraAliases?: MatchAlias[]; history?: Record<string, number> } = {},
): MatchContext {
  const retailerKey = opts.retailerKey ?? "agrawal";
  return {
    retailerId: "me",
    skus: SKUS.map((s) => ({
      id: s.code,
      code: s.code,
      name: s.name,
      brand: s.brand,
      category: s.category,
      caseSize: s.caseSize,
      stockCases: s.stock,
    })),
    aliases: [
      ...ALIASES.filter((a) => a.retailer === null || a.retailer === retailerKey).map((a) => ({
        phrase: a.phrase,
        skuId: a.code,
        retailerId: a.retailer ? "me" : null,
        usageCount: a.uses,
        source: "CURATED" as const,
      })),
      ...(opts.extraAliases ?? []),
    ],
    pastOrderCounts: new Map(Object.entries(opts.history ?? {})),
  };
}
