export default function DeskOrderLoading() {
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <span className="sr-only">Loading order…</span>
      <div className="h-8 w-48 animate-pulse rounded bg-slate-200/70" />
      <div className="h-24 animate-pulse rounded-xl bg-slate-200/70" />
      <div className="h-64 animate-pulse rounded-xl bg-slate-200/70" />
    </div>
  );
}
