import "server-only";
import { NextResponse } from "next/server";
import { retailerDataAccess } from "./access";
import { getSession } from "./current-user";
import type { Role } from "./roles";
import type { SessionPayload } from "./session";

/** For route handlers: the session if it has the role, else a JSON 401/403 response. */
export async function requireRoleApi(
  role: Role,
): Promise<{ session: SessionPayload; response?: never } | { session?: never; response: NextResponse }> {
  const session = await getSession();
  if (!session) return { response: NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 }) };
  if (session.role !== role) return { response: NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }) };
  return { session };
}

/**
 * For route handlers returning one retailer's data: allowed for that retailer and the
 * order desk; any other retailer gets 403, no session gets 401.
 */
export async function requireRetailerAccessApi(
  retailerId: string,
): Promise<{ session: SessionPayload; response?: never } | { session?: never; response: NextResponse }> {
  const session = await getSession();
  const outcome = retailerDataAccess(session, retailerId);
  if (outcome === "UNAUTHENTICATED") return { response: NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 }) };
  if (outcome === "FORBIDDEN" || !session) return { response: NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }) };
  return { session };
}
