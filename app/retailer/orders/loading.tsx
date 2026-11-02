import { SkeletonList } from "@/components/retailer/states";

export default function OrdersLoading() {
  return <SkeletonList rows={5} label="Loading… / लोड हो रहा है…" />;
}
