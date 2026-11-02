import { z } from "zod";

/**
 * Record ids in URLs (cuid). Validated before any query so a malformed or oversized
 * path segment never reaches Prisma (which parameterizes it anyway).
 */
export const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "Invalid id");

/** Free-text search terms from query strings. */
export const searchTermSchema = z.string().trim().min(1).max(60);

/** Parsed id or null; callers answer 400/404 without touching the database. */
export function parseId(raw: string | null | undefined): string | null {
  const r = idSchema.safeParse(raw);
  return r.success ? r.data : null;
}
