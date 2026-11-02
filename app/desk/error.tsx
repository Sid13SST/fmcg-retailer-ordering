"use client";

import { useEffect } from "react";

export default function DeskError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <section role="alert" className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
      <h2 className="text-lg font-semibold text-red-800">Could not load this page</h2>
      <p className="mt-1 text-sm text-red-700">Check the connection and try again. No order was changed.</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <button type="button" onClick={reset} className="btn bg-red-700 text-white hover:bg-red-800">
          Try again
        </button>
        <a href="/desk" className="btn btn-danger">
          All orders
        </a>
      </div>
    </section>
  );
}
