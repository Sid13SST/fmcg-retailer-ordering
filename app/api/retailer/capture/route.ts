import { NextResponse } from "next/server";
import { requireRoleApi } from "@/lib/auth/require-role";
import { captureRequestSchema } from "@/lib/capture/confirm-schema";
import { parseCapture } from "@/lib/capture/service";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Read a pasted text order into review cards. Never places an order: the retailer
 * must review and confirm (POST /api/retailer/capture/:id/confirm).
 */
export async function POST(request: Request) {
  const auth = await requireRoleApi("RETAILER");
  if (auth.response) return auth.response;

  const parsed = captureRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_INPUT", issues: parsed.error.issues }, { status: 400 });
  }
  const result = await parseCapture(prisma, auth.session.sub, parsed.data.text, {
    forceOffline: parsed.data.engine === "offline",
  });
  if (!result.ok) return NextResponse.json({ ...result, error: result.code }, { status: 502 });
  return NextResponse.json(result.capture, { status: 201, headers: { "Cache-Control": "no-store" } });
}
