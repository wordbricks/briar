import type { Metadata } from "next";
import { buildPageMetadata } from "../../../seo";
import DocsView, { docsCopy, docsPaths } from "../../../views/docs";

const LOCALE = "ko" as const;
const PAGE = "getStarted" as const;
const PATH = docsPaths[PAGE];

export async function generateMetadata(): Promise<Metadata> {
  const metadata = docsCopy[LOCALE][PAGE].metadata;
  return buildPageMetadata({
    locale: LOCALE,
    path: PATH,
    title: metadata.title,
    description: metadata.description,
  });
}

export default function Page() {
  return <DocsView locale={LOCALE} page={PAGE} />;
}
