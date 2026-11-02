import { NextResponse } from "next/server";
import { requireRoleApi } from "@/lib/auth/require-role";
import { discardCapture } from "@/lib/capture/service";
import { prisma } from "@/lib/db";
import { parseId } from "@/lib/validation";

export const runtime = "nodejs";

/** The retailer threw away a parsed capture without ordering. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRoleApi("RETAILER");
  if (auth.response) return auth.response;
  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ error: "CAPTURE_NOT_FOUND", code: "CAPTURE_NOT_FOUND" }, { status: 404 });
  const ok = await discardCapture(prisma, auth.session.sub, id);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "CAPTURE_CLOSED" }, { status: 409 });
}
