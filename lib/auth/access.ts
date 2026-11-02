/**
 * Data ownership rule shared by every API that returns retailer data (orders, prices,
 * credit): the order desk may read any retailer; a retailer only itself. Pure.
 */
import type { SessionPayload } from "./session";

export type AccessOutcome = "ALLOW" | "UNAUTHENTICATED" | "FORBIDDEN";

export function retailerDataAccess(session: Pick<SessionPayload, "sub" | "role"> | null, retailerId: string): AccessOutcome {
  if (!session) return "UNAUTHENTICATED";
  if (session.role === "ORDER_DESK") return "ALLOW";
  if (session.role === "RETAILER" && session.sub === retailerId) return "ALLOW";
  return "FORBIDDEN";
}
