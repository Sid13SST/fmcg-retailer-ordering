/**
 * CSRF defence in depth for state-changing API calls. The session cookie is already
 * SameSite=Lax (not sent on cross-site POSTs); this additionally refuses any write whose
 * Origin header names another site. Requests without an Origin header (curl, tests,
 * some same-origin form posts in older browsers) are allowed: they carry no ambient
 * cross-site cookie risk beyond what SameSite already blocks.
 */
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isCrossSiteWrite(method: string, originHeader: string | null, requestHost: string | null): boolean {
  if (!UNSAFE_METHODS.has(method.toUpperCase())) return false;
  if (!originHeader) return false;
  if (originHeader === "null") return true; // sandboxed iframes, data: URLs
  try {
    return new URL(originHeader).host !== requestHost;
  } catch {
    return true;
  }
}
