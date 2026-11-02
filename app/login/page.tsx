import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { getSession } from "@/lib/auth/current-user";
import { ROLE_HOME } from "@/lib/auth/roles";
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

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
      <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">Kirana OrderDesk</p>
      <h1 className="mt-1 text-2xl font-bold">Log in with your mobile number</h1>
      <p className="mt-1 text-sm text-slate-600">Retailers and order desk staff use the same login.</p>

      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <LoginForm demoOtp={DEMO_OTP} next={typeof next === "string" ? next : null} />
      </div>

      <section className="mt-6 rounded-xl border border-dashed border-slate-300 p-4 text-sm">
        <h2 className="font-semibold text-slate-700">Demo logins (OTP {DEMO_OTP})</h2>
        <ul className="mt-2 space-y-1 text-slate-600">
          {DEMO_LOGINS.map((d) => (
            <li key={d.phone} className="flex justify-between gap-2">
              <span>{d.label}</span>
              <span className="font-mono">{d.phone}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
