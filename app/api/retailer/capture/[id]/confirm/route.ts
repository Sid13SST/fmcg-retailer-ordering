import { NextResponse } from "next/server";
import { requireRoleApi } from "@/lib/auth/require-role";
import { confirmCaptureSchema } from "@/lib/capture/confirm-schema";
import { confirmCapture } from "@/lib/capture/service";
import { prisma } from "@/lib/db";
import { parseId } from "@/lib/validation";

export const runtime = "nodejs";

const STATUS_FOR_ERROR = {
  STOCK_CONFLICT: 409,
  NOTHING_ORDERABLE: 409,
  STOCK_CHANGED: 409,
  CAPTURE_CLOSED: 409,
  UNKNOWN_SKU: 422,
  INCOMPLETE_REVIEW: 422,
  CAPTURE_NOT_FOUND: 404,
  RETAILER_NOT_FOUND: 401,
} as const;

/** The retailer confirmed the reviewed lines: place the order (source AI_TEXT). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRoleApi("RETAILER");
  if (auth.response) return auth.response;
  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ error: "CAPTURE_NOT_FOUND", code: "CAPTURE_NOT_FOUND" }, { status: 404 });

  const parsed = confirmCaptureSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_INPUT", issues: parsed.error.issues }, { status: 400 });
  }
  const result = await confirmCapture(prisma, auth.session.sub, id, parsed.data);
  if (result.ok) return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  return NextResponse.json({ ...result, error: result.code }, { status: STATUS_FOR_ERROR[result.code] });
}
