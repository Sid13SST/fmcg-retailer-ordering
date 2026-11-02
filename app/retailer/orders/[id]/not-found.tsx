import { EmptyState } from "@/components/retailer/states";
import { getI18n } from "@/lib/i18n-server";

export default async function OrderNotFound() {
  const { m } = await getI18n();
  return <EmptyState icon="🔎" title={m.orders.notFound} body="" action={{ href: "/retailer/orders", label: m.orders.backToOrders }} />;
}
