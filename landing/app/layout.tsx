import type { Metadata } from "next";
import localFont from "next/font/local";
import { headers } from "next/headers";
import "./globals.css";
import { copy } from "./i18n";
import { getRequestLocale } from "./request-locale";

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

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const metadata = copy[locale].metadata;
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "briar.run";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.includes("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;

  return {
    metadataBase: new URL(origin),
    title: metadata.title,
    description: metadata.description,
    icons: {
      icon: "/briar-app-icon.png",
      shortcut: "/briar-app-icon.png",
    },
    openGraph: {
      title: metadata.title,
      description: metadata.socialDescription,
      type: "website",
      locale: metadata.locale,
      url: origin,
      images: [
        {
          url: `${origin}/og-briar-workflow.png`,
          width: 1200,
          height: 630,
          alt: metadata.title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: metadata.title,
      description: metadata.socialDescription,
      images: [`${origin}/og-briar-workflow.png`],
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getRequestLocale();

  return (
    <html lang={locale} data-theme="light" style={{ colorScheme: "light" }}>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
