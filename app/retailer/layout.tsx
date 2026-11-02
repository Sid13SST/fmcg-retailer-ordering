import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/logout-button";
import { BottomNav } from "@/components/retailer/bottom-nav";
import { LanguageToggle } from "@/components/retailer/language-toggle";
import { getSession } from "@/lib/auth/current-user";
import { CartProvider } from "@/lib/cart/cart-store";
import { prisma } from "@/lib/db";
import { getI18n } from "@/lib/i18n-server";

export const dynamic = "force-dynamic";

export default async function RetailerLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session || session.role !== "RETAILER") redirect("/login");
  const retailer = await prisma.retailer.findUnique({ where: { id: session.sub }, select: { id: true, shopName: true } });
  if (!retailer) redirect("/login");
  const { locale, m } = await getI18n();

  return (
    <CartProvider ownerId={retailer.id}>
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-4 py-2">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-600">Kirana OrderDesk</p>
            <p className="truncate text-base font-semibold">{retailer.shopName}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <LanguageToggle locale={locale} label={m.nav.switchTo} ariaLabel={m.nav.switchToLabel} />
            <LogoutButton label={m.nav.logout} />
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-3xl px-4 pb-24 pt-4">{children}</div>
      <BottomNav labels={{ catalogue: m.nav.catalogue, cart: m.nav.cart, orders: m.nav.orders }} />
    </CartProvider>
  );
}
