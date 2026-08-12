import type { Metadata } from "next";
import { headers } from "next/headers";
import {
  copy,
  defaultLocale,
  localizedPath,
  supportedLocales,
  type Locale,
  type RoutePath,
} from "./i18n";

const SOCIAL_TITLE =
  "Delegate agent work. Review the evidence. Ship with confidence.";

/**
 * Resolve the public origin (protocol + host) the current request arrived
 * on. Mirrors Cloudflare's forwarded headers so this works the same in
 * local dev, preview deploys, and production.
 */
export async function resolveOrigin(): Promise<string> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "briar.run";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.includes("localhost") ? "http" : "https");

  return `${protocol}://${host}`;
}

/**
 * Absolute URL for every locale of a given route, keyed by locale code plus
 * `x-default`. Used for both `alternates.languages` metadata and the
 * sitemap's `hreflang` entries so the two never drift apart.
 */
export async function buildAlternateLanguages(
  path: RoutePath,
): Promise<Record<string, string>> {
  const origin = await resolveOrigin();
  const languages: Record<string, string> = {};

  for (const locale of supportedLocales) {
    languages[locale] = `${origin}${localizedPath(locale, path)}`;
  }

  languages["x-default"] = `${origin}${localizedPath(defaultLocale, path)}`;
  return languages;
}

export async function buildPageMetadata({
  locale,
  path,
  title,
  description,
  socialDescription,
}: {
  locale: Locale;
  path: RoutePath;
  title: string;
  description: string;
  socialDescription?: string;
}): Promise<Metadata> {
  const origin = await resolveOrigin();
  const canonical = `${origin}${localizedPath(locale, path)}`;
  const languages = await buildAlternateLanguages(path);
  const ogDescription = socialDescription ?? description;

  return {
    title,
    description,
    alternates: {
      canonical,
      languages,
    },
    openGraph: {
      title: SOCIAL_TITLE,
      description: ogDescription,
      type: "website",
      // `alternateLocale` here would normally produce `og:locale:alternate`,
      // but vinext's metadata renderer doesn't support that field (see
      // RootHtml in root-html.tsx, which emits it directly instead).
      locale: copy[locale].metadata.locale,
      url: canonical,
      images: [
        {
          url: `${origin}/og-briar-workflow.png`,
          width: 1200,
          height: 630,
          alt: SOCIAL_TITLE,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: SOCIAL_TITLE,
      description: ogDescription,
      images: [`${origin}/og-briar-workflow.png`],
    },
  };
}
