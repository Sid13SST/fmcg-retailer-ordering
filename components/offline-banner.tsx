"use client";

import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/**
 * Shown while the browser reports no network. Actions still fail safely (every write is
 * idempotent or re-checked on the server); this just tells the user why before they tap.
 */
export function OfflineBanner({ text }: { text: string }) {
  const online = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
  if (online) return null;
  return (
    <p role="status" className="bg-amber-100 px-4 py-2 text-center text-sm font-medium text-amber-900">
      {text}
    </p>
  );
}
