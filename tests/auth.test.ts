import { describe, expect, it } from "vitest";
import { decideAccess, requiredRoleForPath } from "@/lib/auth/roles";
import { signSession, verifySession } from "@/lib/auth/session";
import { phoneSchema, verifyOtpBodySchema } from "@/lib/auth/phone";
import { DEMO_OTP, MockOtpProvider } from "@/lib/otp/otp-provider";

const SECRET = "test-secret-test-secret-test-secret-0123";

describe("session tokens", () => {
  const now = 1_800_000_000;

  it("round-trips a signed session", async () => {
    const token = await signSession({ sub: "r1", role: "RETAILER", name: "Ramesh" }, SECRET, now);
    const s = await verifySession(token, SECRET, now + 10);
    expect(s).toMatchObject({ sub: "r1", role: "RETAILER", name: "Ramesh" });
  });

  it("rejects a tampered payload (role escalation)", async () => {
    const token = await signSession({ sub: "r1", role: "RETAILER", name: "Ramesh" }, SECRET, now);
    const [, sig] = token.split(".");
    const forged = btoa(JSON.stringify({ sub: "r1", role: "ORDER_DESK", name: "Ramesh", iat: now, exp: now + 999 }))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(await verifySession(`${forged}.${sig}`, SECRET, now)).toBeNull();
  });

  it("rejects a token signed with another secret", async () => {
    const token = await signSession({ sub: "d1", role: "ORDER_DESK", name: "Neha" }, SECRET, now);
    expect(await verifySession(token, "another-secret-another-secret-12345", now)).toBeNull();
  });

  it("rejects expired tokens and garbage", async () => {
    const token = await signSession({ sub: "r1", role: "RETAILER", name: "R" }, SECRET, now, 60);
    expect(await verifySession(token, SECRET, now + 60)).toBeNull();
    expect(await verifySession("not-a-token", SECRET, now)).toBeNull();
    expect(await verifySession(undefined, SECRET, now)).toBeNull();
  });
});

describe("route guard", () => {
  it("maps protected prefixes to roles", () => {
    expect(requiredRoleForPath("/retailer")).toBe("RETAILER");
    expect(requiredRoleForPath("/retailer/orders/1")).toBe("RETAILER");
    expect(requiredRoleForPath("/desk/holds")).toBe("ORDER_DESK");
    expect(requiredRoleForPath("/retailers-info")).toBeNull();
    expect(requiredRoleForPath("/login")).toBeNull();
  });

  it("sends anonymous users to login with next=", () => {
    expect(decideAccess("/desk", null)).toEqual({ allow: false, redirectTo: "/login?next=%2Fdesk" });
  });

  it("bounces the wrong role to its own home", () => {
    expect(decideAccess("/desk/orders", "RETAILER")).toEqual({ allow: false, redirectTo: "/retailer" });
    expect(decideAccess("/retailer", "ORDER_DESK")).toEqual({ allow: false, redirectTo: "/desk" });
  });

  it("allows the right role and public paths", () => {
    expect(decideAccess("/retailer/cart", "RETAILER")).toEqual({ allow: true });
    expect(decideAccess("/login", null)).toEqual({ allow: true });
  });
});

describe("login input validation", () => {
  it("normalises Indian mobile numbers", () => {
    expect(phoneSchema.parse("98270 00001")).toBe("9827000001");
    expect(phoneSchema.parse("+91 98270-00001")).toBe("9827000001");
    expect(phoneSchema.parse("09827000001")).toBe("9827000001");
  });

  it("rejects invalid numbers and OTPs", () => {
    expect(phoneSchema.safeParse("12345").success).toBe(false);
    expect(phoneSchema.safeParse("1827000001").success).toBe(false);
    expect(verifyOtpBodySchema.safeParse({ phone: "9827000001", otp: "12ab56" }).success).toBe(false);
  });

  it("mock OTP accepts only the demo code (A7)", async () => {
    const otp = new MockOtpProvider();
    expect((await otp.send("9827000001")).demoCode).toBe(DEMO_OTP);
    expect(await otp.verify("9827000001", "123456")).toBe(true);
    expect(await otp.verify("9827000001", "654321")).toBe(false);
  });
});
