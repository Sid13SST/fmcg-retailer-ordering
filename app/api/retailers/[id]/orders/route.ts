import { NextResponse } from "next/server";
import { requireRetailerAccessApi } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

/** A retailer's orders, newest first. That retailer or the order desk only. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const retailerId = (await params).id.slice(0, 64);
  const auth = await requireRetailerAccessApi(retailerId);
  if (auth.response) return auth.response;
  const orders = await prisma.order.findMany({
    where: { retailerId, status: { not: "DRAFT" } },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, orderNumber: true, status: true, source: true, grandTotalPaise: true, createdAt: true, rejectionReason: true, holdReason: true },
  });
  return NextResponse.json({ orders });
}
