import { NextResponse } from "next/server";
import { requireRoleApi } from "@/lib/auth/require-role";
import { searchSkus } from "@/lib/capture/service";
import { prisma } from "@/lib/db";
import { searchTermSchema } from "@/lib/validation";

export const runtime = "nodejs";

/** Manual SKU search used to resolve "could not match" lines and to swap items. */
export async function GET(request: Request) {
  const auth = await requireRoleApi("RETAILER");
  if (auth.response) return auth.response;
  const q = searchTermSchema.safeParse(new URL(request.url).searchParams.get("q") ?? "");
  if (!q.success) return NextResponse.json({ results: [] });
  const results = await searchSkus(prisma, auth.session.sub, q.data);
  return NextResponse.json({ results }, { headers: { "Cache-Control": "no-store" } });
}
