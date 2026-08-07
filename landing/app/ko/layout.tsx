import type { Metadata } from "next";
import { RootHtml } from "../root-html";
import { resolveOrigin } from "../seo";

// Root layout for every /ko/* route. See app/(en)/layout.tsx for why this
// exists as a second root layout instead of a single shared one.
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

export default function KoreanRootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <RootHtml locale="ko">{children}</RootHtml>;
}
