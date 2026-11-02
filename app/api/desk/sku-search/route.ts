import { NextResponse } from "next/server";
import { requireRoleApi } from "@/lib/auth/require-role";
import { searchSkus } from "@/lib/capture/service";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

/** SKU search for desk corrections; includes the order's retailer's own aliases. */
export async function GET(request: Request) {
  const auth = await requireRoleApi("ORDER_DESK");
  if (auth.response) return auth.response;
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").slice(0, 60);
  const retailerId = (url.searchParams.get("retailerId") ?? "").slice(0, 64);
  return NextResponse.json({ skus: await searchSkus(prisma, retailerId, q, 10) });
}
