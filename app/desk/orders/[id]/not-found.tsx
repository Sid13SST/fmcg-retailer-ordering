import Link from "next/link";

export default function DeskOrderNotFound() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
      <p className="font-semibold">Order not found</p>
      <Link href="/desk" className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-brand-700">← Back to all orders</Link>
    </div>
  );
}
