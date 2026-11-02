import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current-user";
import { retailerDataAccess } from "@/lib/auth/access";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

/** One order with lines and status history. Owner retailer or order desk only. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const order = await prisma.order.findUnique({
    where: { id: (await params).id.slice(0, 64) },
    include: { lines: true, statusEvents: { orderBy: { createdAt: "asc" } } },
  });
  // A retailer gets 403 for any order that is not theirs, existing or not, so ids cannot be probed.
  if (!order) {
    return session.role === "ORDER_DESK"
      ? NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
      : NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  if (retailerDataAccess(session, order.retailerId) !== "ALLOW") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  return NextResponse.json({ order });
}
