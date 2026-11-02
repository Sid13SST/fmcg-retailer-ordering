import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { LanguageToggle } from "@/components/retailer/language-toggle";
import { getSession } from "@/lib/auth/current-user";
import { ROLE_HOME } from "@/lib/auth/roles";
import { fmt } from "@/lib/i18n-format";
import { getI18n } from "@/lib/i18n-server";
import { DEMO_OTP } from "@/lib/otp/otp-provider";

export const dynamic = "force-dynamic";

const DEMO_LOGINS = [
  { label: "Retailer — Agrawal Kirana Stores", phone: "9827000001" },
  { label: "Retailer — Irfan Provision Store (over credit limit)", phone: "9827000003" },
  { label: "Order desk — Neha Sharma", phone: "9000000001" },
];

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const session = await getSession();
  if (session) redirect(ROLE_HOME[session.role]);
  const { next } = await searchParams;
  const { locale, m } = await getI18n();

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">Kirana OrderDesk</p>
          <h1 className="mt-1 text-2xl font-bold">{m.login.title}</h1>
        </div>
        <LanguageToggle locale={locale} label={m.nav.switchTo} ariaLabel={m.nav.switchToLabel} />
      </div>
      <p className="mt-1 text-sm text-slate-600">{m.login.subtitle}</p>

      <div className="card mt-6 p-5">
        <LoginForm demoOtp={DEMO_OTP} next={typeof next === "string" ? next : null} m={{ ...m.login, networkError: m.common.networkError }} />
      </div>

      <section className="mt-6 rounded-xl border border-dashed border-slate-300 p-4 text-sm">
        <h2 className="font-semibold text-slate-700">{fmt(m.login.demoLogins, { otp: DEMO_OTP })}</h2>
        <ul className="mt-2 space-y-2 text-slate-600">
          {DEMO_LOGINS.map((d) => (
            <li key={d.phone} className="flex flex-wrap justify-between gap-x-2">
              <span>{d.label}</span>
              <span className="font-mono tabular-nums">{d.phone}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
