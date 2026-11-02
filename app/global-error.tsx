"use client";

// Last-resort boundary (root layout failed). Must render its own <html>; bilingual and dependency-free.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "2rem 1rem", textAlign: "center", color: "#0f172a" }}>
        <h1 style={{ fontSize: "1.25rem" }}>Something went wrong · कुछ गड़बड़ हो गई</h1>
        <p style={{ color: "#475569" }}>Please check your connection and try again. · कृपया इंटरनेट जाँचें और फिर से कोशिश करें।</p>
        <button
          type="button"
          onClick={reset}
          style={{ minHeight: 48, padding: "0 1.25rem", borderRadius: 8, border: 0, background: "#ea580c", color: "#fff", fontWeight: 600 }}
        >
          Try again · फिर से
        </button>
      </body>
    </html>
  );
}
