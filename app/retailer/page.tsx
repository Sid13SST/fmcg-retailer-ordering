import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { getSession } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";
import { formatINR } from "@/lib/money";
import { availableCreditPaise } from "@/lib/pricing";

export const dynamic = "force-dynamic";

// Placeholder home; catalogue, cart and checkout arrive in chunk 2.
export default async function RetailerHome() {
  const session = await getSession();
  if (!session || session.role !== "RETAILER") redirect("/login");
  const retailer = await prisma.retailer.findUnique({ where: { id: session.sub } });
  if (!retailer) redirect("/login");

  return (
    <>
      <AppHeader title={retailer.shopName} userName={retailer.name} />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label="Credit limit" value={formatINR(retailer.creditLimitPaise)} />
          <Stat label="Credit used" value={formatINR(retailer.creditUsedPaise)} />
          <Stat label="Available credit" value={formatINR(availableCreditPaise(retailer))} />
        </div>
        <p className="mt-6 text-sm text-slate-600">The catalogue and ordering screens are coming next.</p>
      </main>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
