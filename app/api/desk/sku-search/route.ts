import { NextResponse } from "next/server";
import { requireRoleApi } from "@/lib/auth/require-role";
import { searchSkus } from "@/lib/capture/service";
import { prisma } from "@/lib/db";
import { parseId, searchTermSchema } from "@/lib/validation";

export const runtime = "nodejs";

/** SKU search for desk corrections; includes the order's retailer's own aliases. */
export async function GET(request: Request) {
  const auth = await requireRoleApi("ORDER_DESK");
  if (auth.response) return auth.response;
  const url = new URL(request.url);
  const q = searchTermSchema.safeParse(url.searchParams.get("q") ?? "");
  if (!q.success) return NextResponse.json({ skus: [] });
  // retailerId only widens the search with that retailer's own aliases; optional.
  const retailerId = parseId(url.searchParams.get("retailerId")) ?? "";
  return NextResponse.json({ skus: await searchSkus(prisma, retailerId, q.data, 10) });
}
