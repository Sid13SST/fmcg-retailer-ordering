/**
 * Roles and route ownership. Mirrors the Prisma `Role` enum; extend both together
 * (SALESMAN arrives in a later chunk).
 */
export const ROLES = ["RETAILER", "ORDER_DESK"] as const;
export type Role = (typeof ROLES)[number];

/** Path prefix each role owns, and where it lands after login. */
export const ROLE_HOME: Record<Role, string> = {
  RETAILER: "/retailer",
  ORDER_DESK: "/desk",
};

/** Which role a protected path requires, or null if the path is public. */
export function requiredRoleForPath(pathname: string): Role | null {
  for (const role of ROLES) {
    const prefix = ROLE_HOME[role];
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return role;
  }
  return null;
}

export type AccessDecision =
  | { allow: true }
  | { allow: false; redirectTo: string };

/** Pure guard used by middleware: decides allow vs redirect for a request. */
export function decideAccess(pathname: string, sessionRole: Role | null): AccessDecision {
  const required = requiredRoleForPath(pathname);
  if (!required) return { allow: true };
  if (!sessionRole) return { allow: false, redirectTo: `/login?next=${encodeURIComponent(pathname)}` };
  if (sessionRole !== required) return { allow: false, redirectTo: ROLE_HOME[sessionRole] };
  return { allow: true };
}
