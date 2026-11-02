"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CartCount } from "./cart-count";

type Tab = { href: string; label: string; icon: string; showCount?: boolean };

export function BottomNav({ labels }: { labels: { catalogue: string; capture: string; cart: string; orders: string } }) {
  const pathname = usePathname();
  const tabs: Tab[] = [
    { href: "/retailer/catalogue", label: labels.catalogue, icon: "🛒" },
    { href: "/retailer/capture", label: labels.capture, icon: "💬" },
    { href: "/retailer/cart", label: labels.cart, icon: "🧺", showCount: true },
    { href: "/retailer/orders", label: labels.orders, icon: "📦" },
  ];
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]">
      <ul className="mx-auto grid max-w-3xl grid-cols-4">
        {tabs.map((t) => {
          const active = pathname === t.href || pathname.startsWith(`${t.href}/`) || (t.href.endsWith("/cart") && pathname.startsWith("/retailer/checkout"));
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-14 flex-col items-center justify-center text-xs font-medium ${
                  active ? "text-brand-700" : "text-slate-600"
                }`}
              >
                <span aria-hidden className="text-lg leading-none">
                  {t.icon}
                </span>
                <span className="mt-1 flex items-center">
                  {t.label}
                  {t.showCount && <CartCount />}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
