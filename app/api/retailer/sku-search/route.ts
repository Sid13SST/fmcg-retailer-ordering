import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRoleApi } from "@/lib/auth/require-role";
import { searchSkus } from "@/lib/capture/service";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

const querySchema = z.string().trim().min(1).max(60);

/** Manual SKU search used to resolve "could not match" lines and to swap items. */
export async function GET(request: Request) {
  const auth = await requireRoleApi("RETAILER");
  if (auth.response) return auth.response;
  const q = querySchema.safeParse(new URL(request.url).searchParams.get("q") ?? "");
  if (!q.success) return NextResponse.json({ results: [] });
  const results = await searchSkus(prisma, auth.session.sub, q.data);
  return NextResponse.json({ results }, { headers: { "Cache-Control": "no-store" } });
}
