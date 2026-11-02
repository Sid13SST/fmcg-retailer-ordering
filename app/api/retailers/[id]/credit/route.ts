import { NextResponse } from "next/server";
import { requireRetailerAccessApi } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db";
import { availableCreditPaise } from "@/lib/pricing";

export const runtime = "nodejs";

/** Credit limit, used and available (paise). That retailer or the order desk only. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const retailerId = (await params).id.slice(0, 64);
  const auth = await requireRetailerAccessApi(retailerId);
  if (auth.response) return auth.response;
  const r = await prisma.retailer.findUnique({ where: { id: retailerId }, select: { creditLimitPaise: true, creditUsedPaise: true } });
  if (!r) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ credit: { ...r, availablePaise: availableCreditPaise(r) } });
}
