import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { OfflineBanner } from "@/components/offline-banner";
import { getSession } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

export default async function DeskLayout({ children }: { children: React.ReactNode }) {
  // Middleware already guards /desk; this is defence in depth for server rendering.
  const session = await getSession();
  if (!session) redirect("/login?next=/desk");
  if (session.role !== "ORDER_DESK") redirect("/retailer");

  return (
    <>
      <AppHeader title="Order desk" userName={session.name} />
      <OfflineBanner text="You are offline. Desk actions will fail until the connection is back; nothing is changed half-way." />
      <nav className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl gap-4 px-4 text-sm">
          <Link href="/desk" className="inline-flex min-h-11 items-center font-medium text-slate-700 hover:text-brand-700">
            Orders
          </Link>
        </div>
      </nav>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </>
  );
}
