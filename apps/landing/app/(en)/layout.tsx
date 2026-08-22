import type { Metadata } from "next";
import { RootHtml } from "../root-html";
import { resolveOrigin } from "../seo";

// This is a root layout for a *route group* ((en) is invisible in the
// URL), not a nested layout. Next.js requires every top-level branch to
// supply its own <html>/<body> when there is no single shared
// app/layout.tsx — see app/ko/layout.tsx for the other branch. Page-level
// `generateMetadata` (see app/(en)/page.tsx etc.) provides the per-page
// title/description/canonical/alternates; this layout only supplies the
// site-wide defaults.
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

export default function EnglishRootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <RootHtml locale="en">{children}</RootHtml>;
}
