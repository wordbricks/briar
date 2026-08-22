import type { Metadata } from "next";
import { buildPageMetadata } from "../../seo";
import BlogView, { blogCopy } from "../../views/blog";

const LOCALE = "en" as const;
const PATH = "/blog" as const;

export async function generateMetadata(): Promise<Metadata> {
  const metadata = blogCopy[LOCALE].metadata;
  return buildPageMetadata({
    locale: LOCALE,
    path: PATH,
    title: metadata.title,
    description: metadata.description,
  });
}

export default function Page() {
  return <BlogView locale={LOCALE} />;
}
