"use client";

import { useEffect } from "react";

// Error boundaries cannot read the server locale, so the message is bilingual.
export default function RetailerError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <section role="alert" className="mt-6 rounded-xl border border-red-200 bg-red-50 p-6 text-center">
      <h1 className="text-lg font-semibold text-red-800">Something went wrong · कुछ गड़बड़ हो गई</h1>
      <p className="mt-1 text-sm text-red-700">
        Please check your connection and try again. · कृपया इंटरनेट जाँचें और फिर से कोशिश करें।
      </p>
      <div className="mt-4 flex justify-center gap-2">
        <button type="button" onClick={reset} className="min-h-11 rounded-md bg-red-700 px-5 font-semibold text-white">
          Try again · फिर से
        </button>
        <a href="/retailer/catalogue" className="inline-flex min-h-11 items-center rounded-md border border-red-300 px-5 font-semibold text-red-800">
          Catalogue · सामान
        </a>
      </div>
    </section>
  );
}
