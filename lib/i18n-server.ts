import "server-only";
import { cookies } from "next/headers";
import { getMessages, LOCALE_COOKIE, parseLocale, type Locale, type Messages } from "./i18n";

export async function getLocale(): Promise<Locale> {
  return parseLocale((await cookies()).get(LOCALE_COOKIE)?.value);
}

export async function getI18n(): Promise<{ locale: Locale; m: Messages }> {
  const locale = await getLocale();
  return { locale, m: getMessages(locale) };
}
