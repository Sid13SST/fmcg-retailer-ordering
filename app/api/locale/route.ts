import { NextResponse } from "next/server";
import { z } from "zod";
import { LOCALE_COOKIE, localeSchema } from "@/lib/i18n";

const bodySchema = z.object({ locale: localeSchema });

/**
 * Plain HTML form target (works without JavaScript): sets the language cookie and
 * sends the user back to the page they were on (same-origin Referer only).
 */
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const parsed = bodySchema.safeParse({ locale: form?.get("locale") });
  const url = new URL(request.url);

  let back = new URL("/", url);
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      const ref = new URL(referer);
      if (ref.origin === url.origin) back = ref;
    } catch {
      // ignore malformed referer
    }
  }

  const response = NextResponse.redirect(back, { status: 303 });
  if (parsed.success) {
    response.cookies.set(LOCALE_COOKIE, parsed.data.locale, {
      path: "/",
      sameSite: "lax",
      maxAge: 365 * 24 * 60 * 60,
    });
  }
  return response;
}
