import { cookies, headers } from "next/headers";
import {
  isLocale,
  localeCookieName,
  resolveBrowserLocale,
  type Locale,
} from "./i18n";

export async function getRequestLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const savedLocale = cookieStore.get(localeCookieName)?.value;

  if (isLocale(savedLocale)) {
    return savedLocale;
  }

  const requestHeaders = await headers();
  return resolveBrowserLocale(requestHeaders.get("accept-language"));
}
