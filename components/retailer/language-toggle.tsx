import type { Locale } from "@/lib/i18n";

/** Plain form so switching language works even before JavaScript loads. */
export function LanguageToggle({ locale, label, ariaLabel }: { locale: Locale; label: string; ariaLabel: string }) {
  return (
    <form action="/api/locale" method="post">
      <input type="hidden" name="locale" value={locale === "en" ? "hi" : "en"} />
      <button
        type="submit"
        aria-label={ariaLabel}
        className="min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-100"
      >
        {label}
      </button>
    </form>
  );
}
