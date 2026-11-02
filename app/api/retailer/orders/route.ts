import { NextResponse } from "next/server";
import { requireRoleApi } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db";
import { placeOrderInputSchema } from "@/lib/orders/cart-schema";
import { createRetailerOrder } from "@/lib/orders/create-order";

export const runtime = "nodejs";

const STATUS_FOR_ERROR = {
  STOCK_CONFLICT: 409,
  NOTHING_ORDERABLE: 409,
  STOCK_CHANGED: 409,
  UNKNOWN_SKU: 422,
  RETAILER_NOT_FOUND: 401,
} as const;

/** Place an order from the cart. Stock, schemes and credit are re-checked here. */
export async function POST(request: Request) {
  const auth = await requireRoleApi("RETAILER");
  if (auth.response) return auth.response;

  const parsed = placeOrderInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_INPUT", issues: parsed.error.issues }, { status: 400 });
  }

  const result = await createRetailerOrder(prisma, auth.session.sub, parsed.data);
  if (result.ok) return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  return NextResponse.json({ ...result, error: result.code }, { status: STATUS_FOR_ERROR[result.code] });
}
