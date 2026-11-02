"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Step = "phone" | "otp";

export function LoginForm({ demoOtp, next }: { demoOtp: string; next: string | null }) {
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
    const data = (await res.json().catch(() => ({}))) as { error?: string; redirectTo?: string };
    return { ok: res.ok, data };
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (step === "phone") {
        const { ok, data } = await post("/api/auth/request-otp", { phone });
        if (!ok) return setError(data.error ?? "Could not send OTP");
        setStep("otp");
      } else {
        const { ok, data } = await post("/api/auth/verify-otp", { phone, otp });
        if (!ok) return setError(data.error ?? "Login failed");
        const home = data.redirectTo ?? "/";
        // Only follow ?next= if it belongs to the role's own area.
        router.replace(next && next.startsWith(home) ? next : home);
        router.refresh();
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="phone" className="block text-sm font-medium text-slate-700">
          Mobile number
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
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-base disabled:bg-slate-100"
          required
        />
      </div>

      {step === "otp" && (
        <div>
          <label htmlFor="otp" className="block text-sm font-medium text-slate-700">
            OTP
          </label>
          <input
            id="otp"
            name="otp"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-base tracking-widest"
            autoFocus
            required
          />
          <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Demo mode: no SMS is sent. Use OTP <strong className="font-mono">{demoOtp}</strong>.
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
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
            className="rounded-md border border-slate-300 px-4 py-2 text-sm"
          >
            Change number
          </button>
        )}
        <button
          type="submit"
          disabled={busy}
          className="flex-1 rounded-md bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {busy ? "Please wait…" : step === "phone" ? "Send OTP" : "Log in"}
        </button>
      </div>
    </form>
  );
}
