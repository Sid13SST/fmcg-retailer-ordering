"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Messages } from "@/lib/i18n";
import { fmt } from "@/lib/i18n-format";

type Step = "phone" | "otp";
type LoginMessages = Messages["login"] & { networkError: string };

const ERROR_KEY = {
  INVALID_PHONE: "invalidPhone",
  INVALID_OTP: "invalidOtp",
  WRONG_OTP: "wrongOtp",
  NOT_REGISTERED: "notRegistered",
} as const;

export function LoginForm({ demoOtp, next, m }: { demoOtp: string; next: string | null; m: LoginMessages }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function post(url: string, body: unknown) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { code?: keyof typeof ERROR_KEY; redirectTo?: string };
    return { ok: res.ok, data };
  }

  /** Server error codes are translated here; unknown codes get a generic message. */
  const errorText = (code: string | undefined) => (code && code in ERROR_KEY ? m[ERROR_KEY[code as keyof typeof ERROR_KEY]] : m.failed);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (step === "phone") {
        const { ok, data } = await post("/api/auth/request-otp", { phone });
        if (!ok) return setError(errorText(data.code));
        setStep("otp");
      } else {
        const { ok, data } = await post("/api/auth/verify-otp", { phone, otp });
        if (!ok) return setError(errorText(data.code));
        const home = data.redirectTo ?? "/";
        // Only follow ?next= if it belongs to the role's own area.
        router.replace(next && next.startsWith(home) ? next : home);
        router.refresh();
        return; // keep the button busy until navigation
      }
    } catch {
      setError(m.networkError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div>
        <label htmlFor="phone" className="block text-sm font-medium text-slate-700">
          {m.phone}
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          placeholder="98270 00001"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          disabled={step === "otp"}
          className="field mt-1"
          required
        />
      </div>

      {step === "otp" && (
        <div>
          <label htmlFor="otp" className="block text-sm font-medium text-slate-700">
            {m.otp}
          </label>
          <input
            id="otp"
            name="otp"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
            className="field mt-1 tracking-[0.3em]"
            autoFocus
            required
          />
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{fmt(m.demoMode, { otp: demoOtp })}</p>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        {step === "otp" && (
          <button
            type="button"
            onClick={() => {
              setStep("phone");
              setOtp("");
              setError(null);
            }}
            className="btn btn-lg btn-secondary"
          >
            {m.changeNumber}
          </button>
        )}
        <button type="submit" disabled={busy} className="btn btn-lg btn-primary flex-1">
          {busy ? m.wait : step === "phone" ? m.sendOtp : m.logIn}
        </button>
      </div>
    </form>
  );
}
