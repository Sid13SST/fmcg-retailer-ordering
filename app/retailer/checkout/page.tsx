import { CheckoutView } from "@/components/retailer/checkout-view";
import { getI18n } from "@/lib/i18n-server";

export default async function CheckoutPage() {
  const { m } = await getI18n();
  return (
    <main>
      <h1 className="mb-3 text-xl font-bold">{m.checkout.title}</h1>
      <CheckoutView m={{ cart: m.cart, common: m.common, catalogue: m.catalogue, checkout: m.checkout }} />
    </main>
  );
}
