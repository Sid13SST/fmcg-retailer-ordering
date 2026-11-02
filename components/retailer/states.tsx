import Link from "next/link";

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: string;
  title: string;
  body: string;
  action?: { href: string; label: string };
}) {
  return (
    <section className="mt-6 rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
      <p className="text-3xl" aria-hidden>
        {icon}
      </p>
      <h2 className="mt-2 text-lg font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-slate-600">{body}</p>
      {action && (
        <Link
          href={action.href}
          className="mt-4 inline-flex min-h-11 items-center rounded-md bg-brand-600 px-5 font-semibold text-white"
        >
          {action.label}
        </Link>
      )}
    </section>
  );
}

export function ErrorPanel({
  title,
  body,
  onRetry,
  retryLabel,
  action,
}: {
  title: string;
  body: string;
  onRetry?: () => void;
  retryLabel?: string;
  action?: { href: string; label: string };
}) {
  return (
    <section role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-5 text-center">
      <h2 className="font-semibold text-red-800">{title}</h2>
      <p className="mt-1 text-sm text-red-700">{body}</p>
      <div className="mt-3 flex justify-center gap-2">
        {onRetry && (
          <button type="button" onClick={onRetry} className="min-h-11 rounded-md bg-red-700 px-5 font-semibold text-white">
            {retryLabel}
          </button>
        )}
        {action && (
          <Link href={action.href} className="inline-flex min-h-11 items-center rounded-md border border-red-300 px-5 font-semibold text-red-800">
            {action.label}
          </Link>
        )}
      </div>
    </section>
  );
}

export function SkeletonList({ rows = 3, label }: { rows?: number; label: string }) {
  return (
    <div role="status" aria-live="polite" className="mt-2 space-y-3">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-28 animate-pulse rounded-xl bg-slate-200/70" />
      ))}
    </div>
  );
}
