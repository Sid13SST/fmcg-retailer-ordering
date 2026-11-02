import { NextResponse } from "next/server";
import { verifyOtpBodySchema } from "@/lib/auth/phone";
import { findIdentityByPhone } from "@/lib/auth/login";
import { ROLE_HOME } from "@/lib/auth/roles";
import { getSessionSecret, SESSION_COOKIE, SESSION_TTL_SECONDS, signSession } from "@/lib/auth/session";
import { otpProvider } from "@/lib/otp/otp-provider";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const parsed = verifyOtpBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  const { phone, otp } = parsed.data;
  if (!(await otpProvider.verify(phone, otp))) {
    return NextResponse.json({ error: "Incorrect OTP" }, { status: 401 });
  }
  const identity = await findIdentityByPhone(phone);
  if (!identity) {
    return NextResponse.json({ error: "This number is not registered with the distributor" }, { status: 404 });
  }
  const token = await signSession({ sub: identity.id, role: identity.role, name: identity.name }, getSessionSecret());
  const response = NextResponse.json({ ok: true, role: identity.role, redirectTo: ROLE_HOME[identity.role] });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return response;
}
