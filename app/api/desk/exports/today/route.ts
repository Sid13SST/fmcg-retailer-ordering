import { requireRoleApi } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db";
import { exportTodaysApproved } from "@/lib/desk/actions";
import { csvDownload, deskFailure } from "@/lib/desk/http";

export const runtime = "nodejs";

/** Bulk export: every order approved today (IST) and not yet exported, in one CSV (A27). */
export async function POST() {
  const auth = await requireRoleApi("ORDER_DESK");
  if (auth.response) return auth.response;
  const result = await exportTodaysApproved(prisma, { name: auth.session.name });
  if (!result.ok) return deskFailure(result);
  return csvDownload(result.csv, result.fileName, { "X-Exported-Orders": result.orderNumbers.join(",") });
}
