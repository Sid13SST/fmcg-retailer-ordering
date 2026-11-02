import { NextResponse } from "next/server";
import { requireRetailerAccessApi } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db";
import { parseId } from "@/lib/validation";

export const runtime = "nodejs";

/**
 * Dealer prices as they apply to this retailer (per case, excl. GST). Today every
 * retailer gets the single list (A6); a RetailerPriceOverride, when one exists, is
 * shown instead, which is why this is per-retailer and access-controlled.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const retailerId = parseId((await params).id);
  if (!retailerId) return NextResponse.json({ error: "INVALID_INPUT", message: "Invalid id" }, { status: 400 });
  const auth = await requireRetailerAccessApi(retailerId);
  if (auth.response) return auth.response;
  const [skus, overrides] = await Promise.all([
    prisma.sKU.findMany({ where: { active: true }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true, caseSize: true, dealerPricePerCasePaise: true, gstRatePercent: true } }),
    prisma.retailerPriceOverride.findMany({ where: { retailerId } }),
  ]);
  const override = new Map(overrides.map((o) => [o.skuId, o.dealerPricePerCasePaise]));
  return NextResponse.json({
    prices: skus.map((s) => ({ ...s, dealerPricePerCasePaise: override.get(s.id) ?? s.dealerPricePerCasePaise, exclGst: true })),
  });
}
