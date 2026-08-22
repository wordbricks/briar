import { NextResponse, type NextRequest } from "next/server";
import {
  defaultLocale,
  isLocale,
  localeCookieName,
  localizedPath,
  resolveBrowserLocale,
  routePaths,
} from "./app/i18n";

/**
 * Convenience redirect for first-time (or previously-opted-in) visitors to
 * an unprefixed English URL who would rather see a supported localized page.
 *
 * This is intentionally the ONLY place that redirects based on cookie/
 * Accept-Language — every locale still has its own stable, crawlable URL
 * (`/`, `/tutorial`, ... for English; `/ko`, `/ko/tutorial`, ... for
 * Korean; `/zh`, `/zh/tutorial`, ... for Chinese) that renders
 * unconditionally when visited directly, so a
 * crawler or a shared link never depends on this redirect to reach either
 * language. Only routes matched below (the unprefixed pages) are ever
 * redirected; prefixed locale paths are left alone.
 */
export function proxy(request: NextRequest) {
  const cookieLocale = request.cookies.get(localeCookieName)?.value;
  const locale = isLocale(cookieLocale)
    ? cookieLocale
    : resolveBrowserLocale(request.headers.get("accept-language"));

  if (locale === defaultLocale) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = localizedPath(locale, request.nextUrl.pathname);
  return NextResponse.redirect(url, 307);
}

export const config = {
  matcher: [...routePaths],
};
