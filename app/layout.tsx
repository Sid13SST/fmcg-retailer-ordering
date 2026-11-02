import type { Metadata, Viewport } from "next";
import { getLocale } from "@/lib/i18n-server";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kirana OrderDesk",
  description: "Order from your distributor in a minute — catalogue, dealer prices, schemes and live stock.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#ea580c" };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
