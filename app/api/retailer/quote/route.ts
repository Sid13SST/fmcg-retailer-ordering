import { NextResponse } from "next/server";
import { requireRoleApi } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db";
import { quoteInputSchema } from "@/lib/orders/cart-schema";
import { quoteCart } from "@/lib/orders/quote";

export const runtime = "nodejs";

/** Price the retailer's cart with current stock and schemes. Read-only. */
export async function POST(request: Request) {
  const auth = await requireRoleApi("RETAILER");
  if (auth.response) return auth.response;

  const parsed = quoteInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_INPUT", issues: parsed.error.issues }, { status: 400 });
  }
  const quote = await quoteCart(prisma, auth.session.sub, parsed.data);
  if (!quote) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  return NextResponse.json(quote, { headers: { "Cache-Control": "no-store" } });
}
