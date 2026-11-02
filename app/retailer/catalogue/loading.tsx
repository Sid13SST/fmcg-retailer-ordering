export default function CatalogueLoading() {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Loading… / लोड हो रहा है…</span>
      <div className="mb-3 h-9 animate-pulse rounded-lg bg-slate-200/70" />
      <div className="h-12 animate-pulse rounded-md bg-slate-200/70" />
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-40 animate-pulse rounded-xl bg-slate-200/70" />
        ))}
      </div>
    </div>
  );
}
