import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
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
    title: "Briar — 에이전트 개발의 운영체제",
    description:
      "이슈에서 PR까지, 사람과 코딩 에이전트가 함께 일하는 과정을 연결하고 관찰하는 로컬 우선 Agent Development Environment.",
    icons: {
      icon: "/briar-mark.svg",
      shortcut: "/briar-mark.svg",
    },
    openGraph: {
      title: "Briar — 에이전트 개발의 운영체제",
      description:
        "코드는 로컬에. 에이전트 작업은 이슈에서 PR까지 한눈에.",
      type: "website",
      locale: "ko_KR",
      url: origin,
      images: [
        {
          url: `${origin}/og.png`,
          width: 1200,
          height: 630,
          alt: "Briar — 에이전트 개발의 운영체제",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "Briar — 에이전트 개발의 운영체제",
      description:
        "코드는 로컬에. 에이전트 작업은 이슈에서 PR까지 한눈에.",
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
