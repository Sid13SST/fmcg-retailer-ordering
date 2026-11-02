import { NextResponse } from "next/server";
import { requestOtpBodySchema } from "@/lib/auth/phone";
import { findIdentityByPhone } from "@/lib/auth/login";
import { otpProvider } from "@/lib/otp/otp-provider";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const parsed = requestOtpBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request", code: "INVALID_PHONE" }, { status: 400 });
  }
  const identity = await findIdentityByPhone(parsed.data.phone);
  if (!identity) {
    return NextResponse.json({ error: "This number is not registered with the distributor", code: "NOT_REGISTERED" }, { status: 404 });
  }
  const result = await otpProvider.send(parsed.data.phone);
  return NextResponse.json({ sent: result.sent, demoCode: result.demoCode });
}
