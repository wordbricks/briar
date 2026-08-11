import localFont from "next/font/local";
import "./globals.css";
import { GoogleAnalytics } from "./google-analytics";
import { copy, supportedLocales, type Locale } from "./i18n";

// Self-hosted latin-only slices of the Geist variable fonts, extracted
// from the woff2 files Google's own API serves for Geist/Geist Mono at
// wght 100-900. `next/font/google` with `subsets: ["latin"]` still ships
// every script Geist supports
// (latin, latin-ext, cyrillic, cyrillic-ext, vietnamese, +symbols2 for
// Mono) as 5-6 separate woff2 files each, and preloads all of them - 11
// files total - because there's no per-subset filtering. This page only
// ever renders latin text (English + Korean copy, where Korean already
// falls back to a system font since Geist has no Hangul glyphs either
// way) and a handful of decorative symbols (↗ ⌁ ▦ ⌕ ◆ ◇ ＋) that fall
// outside every Geist subset, latin included, so they already render via
// system fallback today. Loading just the latin file per family (still
// the full variable 100-900 weight range, so every fractional
// font-weight in globals.css still interpolates exactly as before) cuts
// 11 preloaded fonts down to 2 with no visual change.
const geistSans = localFont({
  src: "./fonts/geist-sans-latin.woff2",
  variable: "--font-geist-sans",
  weight: "100 900",
  display: "swap",
});

const geistMono = localFont({
  src: "./fonts/geist-mono-latin.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
  display: "swap",
});

/**
 * Shared `<html>`/`<body>` shell for every locale's root layout.
 *
 * Each locale gets its own root layout file (see `app/(en)/layout.tsx` and
 * `app/ko/layout.tsx`) so `<html lang>` is static per-route rather than
 * resolved at request time from a cookie/header — that's what makes each
 * locale's URL independently crawlable with the right `lang`. This
 * component just keeps the actual markup and font wiring in one place.
 */
export function RootHtml({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  // `openGraph.alternateLocale` in each page's generateMetadata() computes
  // the right value, but vinext's metadata renderer (unlike Next.js
  // itself) doesn't turn that field into an `og:locale:alternate` tag —
  // so it's emitted directly here instead. React 19 hoists <meta>/<link>/
  // <title> rendered anywhere in the tree into <head>, so this works even
  // though it's rendered inside <body>.
  const otherLocales = supportedLocales.filter((candidate) => candidate !== locale);

  return (
    <html lang={locale} data-theme="light" style={{ colorScheme: "light" }}>
      <head>
        <GoogleAnalytics />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {otherLocales.map((otherLocale) => (
          <meta
            key={otherLocale}
            property="og:locale:alternate"
            content={copy[otherLocale].metadata.locale}
          />
        ))}
        {children}
      </body>
    </html>
  );
}
