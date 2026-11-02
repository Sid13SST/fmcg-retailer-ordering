import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { getSession } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// Placeholder home; the order desk dashboard arrives in chunk 4.
export default async function DeskHome() {
  const session = await getSession();
  if (!session || session.role !== "ORDER_DESK") redirect("/login");

  const [pending, onHold] = await Promise.all([
    prisma.order.count({ where: { status: "PENDING_DESK_REVIEW" } }),
    prisma.order.count({ where: { status: "ON_HOLD" } }),
  ]);

  return (
    <>
      <AppHeader title="Order desk" userName={session.name} />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Awaiting review</p>
            <p className="mt-1 text-2xl font-semibold">{pending}</p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-xs uppercase tracking-wide text-amber-700">On credit hold</p>
            <p className="mt-1 text-2xl font-semibold">{onHold}</p>
          </div>
        </div>
        <p className="mt-6 text-sm text-slate-600">The review dashboard and Tally export are coming next.</p>
      </main>
    </>
  );
}
