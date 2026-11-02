import { NextResponse } from "next/server";
import { requireRoleApi } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db";
import { holdOrder } from "@/lib/desk/actions";
import { deskFailure, invalidInput, readJson } from "@/lib/desk/http";
import { holdBodySchema } from "@/lib/desk/schemas";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRoleApi("ORDER_DESK");
  if (auth.response) return auth.response;
  const body = holdBodySchema.safeParse(await readJson(request));
  if (!body.success) return invalidInput(body.error);
  const result = await holdOrder(prisma, (await params).id, { name: auth.session.name }, body.data.reason);
  return result.ok ? NextResponse.json(result) : deskFailure(result);
}
