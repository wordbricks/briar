import localFont from "next/font/local";
import "./globals.css";
import { GoogleAnalytics } from "./google-analytics";
import { copy, supportedLocales, type Locale } from "./i18n";

// Pretendard is self-hosted so the Latin and Hangul portions of the landing
// site use the same metrics at every locale and do not depend on a third-party
// font request. The variable font keeps the existing fractional weights while
// Han glyphs continue to fall back to the platform's Chinese font.
const pretendard = localFont({
  src: "./fonts/PretendardVariable.woff2",
  variable: "--font-pretendard",
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
 * Each locale gets its own root layout file (see `app/(en)/layout.tsx`,
 * `app/ko/layout.tsx`, and `app/zh/layout.tsx`) so `<html lang>` is static per-route rather than
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
      <body className={`${pretendard.variable} ${geistMono.variable}`}>
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
