import { NextResponse } from "next/server";
import { requireRoleApi } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db";
import { rejectOrder } from "@/lib/desk/actions";
import { deskFailure, invalidId, invalidInput, readJson } from "@/lib/desk/http";
import { rejectBodySchema } from "@/lib/desk/schemas";
import { parseId } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRoleApi("ORDER_DESK");
  if (auth.response) return auth.response;
  const body = rejectBodySchema.safeParse(await readJson(request));
  if (!body.success) return invalidInput(body.error);
  const id = parseId((await params).id);
  if (!id) return invalidId();
  const result = await rejectOrder(prisma, id, { name: auth.session.name }, body.data.reason);
  return result.ok ? NextResponse.json(result) : deskFailure(result);
}
