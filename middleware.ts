import { NextResponse, type NextRequest } from "next/server";
import { decideAccess } from "@/lib/auth/roles";
import { getSessionSecret, SESSION_COOKIE, verifySession } from "@/lib/auth/session";

/** Guards /retailer/* to RETAILER and /desk/* to ORDER_DESK. */
export async function middleware(request: NextRequest) {
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value, getSessionSecret());
  const decision = decideAccess(request.nextUrl.pathname, session?.role ?? null);
  if (decision.allow) return NextResponse.next();
  return NextResponse.redirect(new URL(decision.redirectTo, request.url));
}

export const config = {
  matcher: ["/retailer", "/retailer/:path*", "/desk", "/desk/:path*"],
};
