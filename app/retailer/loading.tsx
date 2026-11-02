import { SkeletonList } from "@/components/retailer/states";

// Locale is not resolved in a Suspense fallback; the screen-reader label is bilingual.
export default function RetailerLoading() {
  return <SkeletonList rows={3} label="Loading… / लोड हो रहा है…" />;
}
