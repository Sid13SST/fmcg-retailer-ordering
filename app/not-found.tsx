import Link from "next/link";

// Rendered outside any role layout, so it cannot know the locale: bilingual on purpose.
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4 text-center">
      <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">Kirana OrderDesk</p>
      <h1 className="mt-2 text-xl font-bold">Page not found · पेज नहीं मिला</h1>
      <p className="mt-1 text-sm text-slate-600">The link may be old or mistyped. · लिंक पुराना या गलत हो सकता है।</p>
      <Link href="/" className="btn btn-lg btn-primary mt-6">
        Go home · होम पर जाएँ
      </Link>
    </main>
  );
}
