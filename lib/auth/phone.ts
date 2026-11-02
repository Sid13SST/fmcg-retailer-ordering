import { z } from "zod";

/**
 * Indian mobile number: accepts "98270 00001", "+91 9827000001", "09827000001"
 * and normalises to the 10-digit form stored in the database.
 */
export const phoneSchema = z
  .string()
  .trim()
  .transform((raw) => raw.replace(/[\s-]/g, "").replace(/^(\+91|91|0)(?=\d{10}$)/, ""))
  .pipe(z.string().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number"));

export const otpSchema = z.string().trim().regex(/^\d{6}$/, "OTP must be 6 digits");

export const requestOtpBodySchema = z.object({ phone: phoneSchema });
export const verifyOtpBodySchema = z.object({ phone: phoneSchema, otp: otpSchema });
