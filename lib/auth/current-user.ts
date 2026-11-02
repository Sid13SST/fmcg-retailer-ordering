import "server-only";
import { cookies } from "next/headers";
import { getSessionSecret, SESSION_COOKIE, verifySession, type SessionPayload } from "./session";

/** Read and verify the session cookie in a Server Component / Route Handler. */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value, getSessionSecret());
}
