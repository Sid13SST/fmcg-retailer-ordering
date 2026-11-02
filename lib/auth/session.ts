/**
 * Signed session tokens: base64url(JSON payload) + "." + base64url(HMAC-SHA256).
 * Uses Web Crypto only, so it runs in both the Edge middleware and Node routes.
 */
import { z } from "zod";
import { ROLES } from "./roles";

export const SESSION_COOKIE = "kod_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export const sessionPayloadSchema = z.object({
  sub: z.string().min(1),
  role: z.enum(ROLES),
  name: z.string().min(1),
  iat: z.number().int(),
  exp: z.number().int(),
});
export type SessionPayload = z.infer<typeof sessionPayloadSchema>;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be set to a string of at least 32 characters (see .env.example)");
  }
  return secret;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function signSession(
  data: Pick<SessionPayload, "sub" | "role" | "name">,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  ttlSeconds = SESSION_TTL_SECONDS,
): Promise<string> {
  const payload: SessionPayload = { ...data, iat: nowSeconds, exp: nowSeconds + ttlSeconds };
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(body));
  return `${body}.${toBase64Url(new Uint8Array(sig))}`;
}

/** Returns the payload if the token is authentic and unexpired, else null. Never throws on bad tokens. */
export async function verifySession(
  token: string | undefined | null,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<SessionPayload | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts as [string, string];
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromBase64Url(sig), encoder.encode(body));
    if (!ok) return null;
    const parsed = sessionPayloadSchema.safeParse(JSON.parse(decoder.decode(fromBase64Url(body))));
    if (!parsed.success) return null;
    if (parsed.data.exp <= nowSeconds) return null;
    return parsed.data;
  } catch {
    return null;
  }
}
