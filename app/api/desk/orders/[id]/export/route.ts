import { NextResponse } from "next/server";
import { requireRoleApi } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db";
import { exportOrderToTally } from "@/lib/desk/actions";
import { csvDownload, deskFailure } from "@/lib/desk/http";

export const runtime = "nodejs";

/** Export an approved order to Tally (mocked CSV, A8). Marks it EXPORTED. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRoleApi("ORDER_DESK");
  if (auth.response) return auth.response;
  const result = await exportOrderToTally(prisma, (await params).id, { name: auth.session.name });
  if (!result.ok) return deskFailure(result);
  return csvDownload(result.csv, result.fileName, { "X-Exported-Orders": result.orderNumbers.join(",") });
}

/** Download again the CSV stored when this order was exported. Does not change the order. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRoleApi("ORDER_DESK");
  if (auth.response) return auth.response;
  const id = (await params).id;
  const row = await prisma.tallyExport.findFirst({
    where: { orderId: id },
    orderBy: { exportedAt: "desc" },
    include: { order: { select: { orderNumber: true } } },
  });
  if (!row) return NextResponse.json({ error: "NOT_FOUND", message: "This order has not been exported." }, { status: 404 });
  return csvDownload(row.csvPayload, `tally-${row.order.orderNumber}.csv`);
}
