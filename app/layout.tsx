import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kirana OrderDesk",
  description: "Order from your distributor in a minute — catalogue, dealer prices, schemes and live stock.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
