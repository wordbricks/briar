import type { Metadata } from "next";
import { RootHtml } from "../root-html";
import { resolveOrigin } from "../seo";

// Root layout for every /zh/* route. The static lang attribute keeps the
// Chinese URL independently crawlable and accessible to assistive technology.
export async function generateMetadata(): Promise<Metadata> {
  const origin = await resolveOrigin();

  return {
    metadataBase: new URL(origin),
    icons: {
      icon: "/briar-app-icon.png",
      shortcut: "/briar-app-icon.png",
    },
  };
}

export default function ChineseRootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <RootHtml locale="zh">{children}</RootHtml>;
}
