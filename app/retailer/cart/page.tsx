import { CartView } from "@/components/retailer/cart-view";
import { getI18n } from "@/lib/i18n-server";

export default async function CartPage() {
  const { m } = await getI18n();
  return (
    <main>
      <h1 className="mb-1 text-xl font-bold">{m.cart.title}</h1>
      <CartView m={{ cart: m.cart, common: m.common, catalogue: m.catalogue }} />
    </main>
  );
}
