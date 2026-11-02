import { NextResponse } from "next/server";
import { requireRoleApi } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db";
import { correctOrderLine } from "@/lib/desk/actions";
import { deskFailure, invalidId, invalidInput, readJson } from "@/lib/desk/http";
import { correctLineBodySchema } from "@/lib/desk/schemas";
import { parseId } from "@/lib/validation";

export const runtime = "nodejs";

/** Correct one line: swap the SKU and/or change the quantity. AI lines teach the retailer alias. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; lineId: string }> }) {
  const auth = await requireRoleApi("ORDER_DESK");
  if (auth.response) return auth.response;
  const body = correctLineBodySchema.safeParse(await readJson(request));
  if (!body.success) return invalidInput(body.error);
  const p = await params;
  const id = parseId(p.id);
  const lineId = parseId(p.lineId);
  if (!id || !lineId) return invalidId();
  const result = await correctOrderLine(prisma, id, { name: auth.session.name }, { lineId, ...body.data });
  return result.ok ? NextResponse.json(result) : deskFailure(result);
}
