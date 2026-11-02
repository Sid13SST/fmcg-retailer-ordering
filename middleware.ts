import { NextResponse, type NextRequest } from "next/server";
import { isCrossSiteWrite } from "@/lib/auth/origin";
import { decideAccess } from "@/lib/auth/roles";
import { getSessionSecret, SESSION_COOKIE, verifySession } from "@/lib/auth/session";

/**
 * Pages: guards /retailer/* to RETAILER and /desk/* to ORDER_DESK.
 * APIs: refuses cross-site writes (each route handler still checks the role itself).
 */
export async function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    if (isCrossSiteWrite(request.method, request.headers.get("origin"), host)) {
      return NextResponse.json({ error: "FORBIDDEN", message: "Cross-site request refused" }, { status: 403 });
    }
    return NextResponse.next();
  }
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value, getSessionSecret());
  const decision = decideAccess(request.nextUrl.pathname, session?.role ?? null);
  if (decision.allow) return NextResponse.next();
  return NextResponse.redirect(new URL(decision.redirectTo, request.url));
}

export const config = {
  matcher: ["/retailer", "/retailer/:path*", "/desk", "/desk/:path*", "/api/:path*"],
};
